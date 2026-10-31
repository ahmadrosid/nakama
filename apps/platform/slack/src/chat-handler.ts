import { dirname } from "node:path";
import type { NakamaClient, RemoteChatSession } from "@nakama/client";
import { formatClientError } from "@nakama/core/api-error";
import {
  clearActiveStream,
  isAbortError,
  registerActiveStream,
  stopActiveStream,
} from "@nakama/core/channel-active-stream";
import { createChatLock } from "@nakama/core/channel-chat-lock";
import type { ChannelOwner } from "@nakama/core/channel-config-shared";
import type { ChannelSessionStore } from "@nakama/core/channel-session-store";
import { readTextOrNull, writeTextFile } from "@nakama/core/fs";
import {
  hasActiveHandshakeCode,
  isSlackUserAuthorized,
  isSlackWorkspaceMember,
  loadSlackConfigFile,
  looksLikePairingCode,
  type SlackMember,
  verifyAndPairSlackUser,
} from "@nakama/core/slack-config";
import type { SlackMessageEvent } from "./socket";

/** What the handler needs from Slack's Web API; faked in tests. */
export interface SlackApi {
  addReaction(channel: string, ts: string, name: string): Promise<void>;
  /** users.info; throws when the user is unknown or the scope is missing. */
  getMember(userId: string): Promise<SlackMember>;
  postMessage(channel: string, text: string, threadTs?: string): Promise<void>;
  removeReaction(channel: string, ts: string, name: string): Promise<void>;
}

export interface ChatHandlerDeps {
  /** The bot's own workspace; the only team the workspace gate lets in. */
  botTeamId: string;
  botUserId: string;
  client: NakamaClient;
  /** The agent this Slack app is connected to; every chat runs as it. */
  owner: ChannelOwner;
  sessionStore: ChannelSessionStore;
  slack: SlackApi;
}

const chatLock = createChatLock({ waitMs: 15 * 60 * 1000 });

const WORKING_REACTION = "eyes";

/** How long a users.info answer is trusted before a member is looked up again. */
const MEMBER_CACHE_MS = 10 * 60 * 1000;

// The server can finish a turn after the worker dies, so "send it again" alone
// could run the work twice.
const INTERRUPTED_REPLY =
  "A restart cut off my reply to this. The work may still have finished, so check before sending it again.";

const STALE_REPLY =
  "I was offline when this arrived and did not act on it. Send it again if you still need it.";

/** Older unstarted events are reported, not run: the moment may have passed. */
const MAX_REPLAY_AGE_SECONDS = 60 * 60;

const CHANNEL_MESSAGE_PREFIX =
  "[Slack channel thread. Your reply is visible to everyone in this channel.]\n";

const PAIRING_PROMPT =
  "Welcome to Nakama.\n\n" +
  "Paste your pairing code from Integrations → Slack in the web dashboard. " +
  "You only need to do this once.";

// Pairing codes stay out of channels: anyone reading could use the code first.
const LINK_IN_DM_REPLY =
  "I can't answer you yet. Link your account first: open Nakama under Apps in the Slack sidebar, go to its Messages tab, and send the pairing code from Integrations → Slack there.";

const NO_CODE_PROMPT =
  "This bot is not linked yet. Open Nakama Integrations → Slack, generate a pairing code, then send it here.";

const HELP_TEXT = [
  "Chat with me in this DM, or @mention me in a channel. I reply in a thread and follow it after that.",
  "",
  "!new: start a fresh conversation",
  "!clear: clear this conversation's history",
  "!stop: stop the current reply",
  "!status: server and model status",
  "!help: this message",
].join("\n");

/** Turns Slack's escaped message text back into what the user typed. */
export function normalizeSlackText(text: string, botUserId: string): string {
  return text
    .replaceAll(`<@${botUserId}>`, "")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();
}

/** Sends a message to the channel or thread matching the inbound Slack event. */
export function replyToSlackEvent(
  slack: Pick<SlackApi, "postMessage">,
  event: SlackMessageEvent,
  message: string
): Promise<void> {
  const isDm = event.channel_type === "im";
  const threadTs = isDm ? event.thread_ts : (event.thread_ts ?? event.ts);

  return slack.postMessage(event.channel, message, threadTs);
}

interface InboxEntry {
  event: SlackMessageEvent;
  started: boolean;
}

/**
 * Events acked to Slack whose turn has not ended, so a crash cannot lose one.
 * `started` is what stops a turn that may have called tools from running twice.
 */
export class SlackEventInbox {
  private entries: Record<string, InboxEntry> = {};
  private saving: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    const raw = await readTextOrNull(this.path);

    try {
      // SAFETY: Only this worker writes the file, always in this shape.
      this.entries = JSON.parse(raw ?? "{}") as Record<string, InboxEntry>;
    } catch (error) {
      console.error("Slack event inbox is unreadable, starting empty:", error);
      this.entries = {};
    }
  }

  has(eventId: string): boolean {
    return eventId in this.entries;
  }

  list() {
    return Object.entries(this.entries);
  }

  async add(eventId: string, event: SlackMessageEvent): Promise<void> {
    this.entries[eventId] = { event, started: false };

    try {
      await this.save();
    } catch (error) {
      delete this.entries[eventId];
      throw error;
    }
  }

  async markStarted(eventId: string): Promise<void> {
    const entry = this.entries[eventId];

    if (entry) {
      entry.started = true;
      await this.save();
    }
  }

  async remove(eventId: string): Promise<void> {
    delete this.entries[eventId];
    await this.save();
  }

  // Each save rewrites the file, so one running late must not undo a newer one.
  private save(): Promise<void> {
    const write = () =>
      writeTextFile(this.path, JSON.stringify(this.entries), {
        ensureDir: dirname(this.path),
      });

    const saved = this.saving.then(write, write);

    this.saving = saved;

    return saved;
  }
}

/** Runs events through the inbox: stored before the ack, removed when the turn ends. */
export function createSlackEventHandler(deps: {
  handleEvent: (
    event: SlackMessageEvent,
    onTurnStart: () => Promise<void>
  ) => Promise<void>;
  inbox: SlackEventInbox;
  slack: Pick<SlackApi, "postMessage" | "removeReaction">;
  /** Most channel traffic is not for the bot and never needs storing. */
  wants: (event: SlackMessageEvent) => boolean;
}) {
  const { inbox } = deps;

  function run(event: SlackMessageEvent, eventId: string): void {
    deps
      .handleEvent(event, () => inbox.markStarted(eventId))
      .catch((error) => {
        console.error("Slack message handler error:", error);

        return replyToSlackEvent(deps.slack, event, formatClientError(error));
      })
      .catch((replyError) => {
        console.error("Failed to post Slack error reply:", replyError);
      })
      .then(() => inbox.remove(eventId))
      .catch((error) => {
        console.error("Failed to clear Slack event:", error);
      });
  }

  return {
    /** The socket acks once this resolves. */
    accept: async (event: SlackMessageEvent, eventId: string) => {
      if (process.env.NAKAMA_CH_DEBUG === "1") {
        console.log(
          `[slack] ${event.type} channel_type=${event.channel_type} subtype=${event.subtype ?? "-"} user=${event.user ?? "-"} thread=${event.thread_ts ? "yes" : "no"}`
        );
      }

      // Redelivered after a crash before the ack, and already being replayed.
      if (inbox.has(eventId) || !deps.wants(event)) {
        return;
      }

      await inbox.add(eventId, event);
      run(event, eventId);
    },

    /** Await on worker start, before the socket opens, so replays go first. */
    recover: async () => {
      const replays: Array<() => void> = [];

      for (const [eventId, { event, started }] of inbox.list()) {
        const age = Date.now() / 1000 - Number(event.ts);

        if (!(started || age > MAX_REPLAY_AGE_SECONDS)) {
          replays.push(() => run(event, eventId));
          continue;
        }

        try {
          await replyToSlackEvent(
            deps.slack,
            event,
            started ? INTERRUPTED_REPLY : STALE_REPLY
          );
          await deps.slack
            .removeReaction(event.channel, event.ts, WORKING_REACTION)
            .catch(() => {});
          await inbox.remove(eventId);
        } catch (error) {
          // Kept, so the next start tells them instead.
          console.error("Failed to post Slack recovery reply:", error);
        }
      }

      for (const replay of replays) {
        replay();
      }
    },
  };
}

/** Whether an event is one the bot acts on, not an edit, a bot post or chatter. */
export function wantsSlackEvent(
  event: SlackMessageEvent,
  botUserId: string,
  sessionStore: Pick<ChannelSessionStore, "get">
): boolean {
  // Edits, joins and bot posts arrive as subtypes; only people's messages
  // start turns. A message with a file still counts, its text is used.
  if (
    event.type !== "message" ||
    (event.subtype &&
      event.subtype !== "thread_broadcast" &&
      event.subtype !== "file_share") ||
    event.bot_id ||
    !event.user ||
    event.user === botUserId
  ) {
    return false;
  }

  // In channels: an @mention opens a thread; after that the bot follows the thread.
  return Boolean(
    event.channel_type === "im" ||
      (event.text ?? "").includes(`<@${botUserId}>`) ||
      (event.thread_ts &&
        sessionStore.get(`${event.channel}:${event.thread_ts}`))
  );
}

export function createChatHandler(deps: ChatHandlerDeps) {
  const { botTeamId, botUserId, owner, sessionStore, slack } = deps;
  const memberCache = new Map<string, { at: number; member: boolean }>();

  // Fails closed: a lookup error (missing users:read, unknown user) is "no".
  async function isWorkspaceMember(userId: string): Promise<boolean> {
    const cached = memberCache.get(userId);

    if (cached && Date.now() - cached.at < MEMBER_CACHE_MS) {
      return cached.member;
    }

    try {
      const member = isSlackWorkspaceMember(
        await slack.getMember(userId),
        botTeamId
      );

      memberCache.set(userId, { at: Date.now(), member });

      return member;
    } catch (error) {
      console.warn(`Slack member lookup failed for ${userId}:`, error);

      return false;
    }
  }

  return async function handleEvent(
    event: SlackMessageEvent,
    onTurnStart?: () => Promise<void>
  ): Promise<void> {
    if (!wantsSlackEvent(event, botUserId, sessionStore)) {
      return;
    }

    const isDm = event.channel_type === "im";
    const raw = event.text ?? "";
    const text = normalizeSlackText(raw, botUserId);
    const threadTs = isDm ? event.thread_ts : (event.thread_ts ?? event.ts);

    const conversationKey = isDm
      ? event.channel
      : `${event.channel}:${threadTs}`;

    // Checked by wantsSlackEvent; narrows the type for the rest of this turn.
    if (!event.user) {
      return;
    }

    const reply = (message: string) => replyToSlackEvent(slack, event, message);

    const config = await loadSlackConfigFile(owner);

    const authorized =
      config !== null &&
      (isSlackUserAuthorized(event.user, config) ||
        (config.allowWorkspace && (await isWorkspaceMember(event.user))));

    if (!(config && authorized)) {
      if (!isDm) {
        // A thread follow-up from someone else stays quiet; a direct mention
        // gets told how to link, or it looks like the bot is broken.
        if (raw.includes(`<@${botUserId}>`)) {
          await reply(LINK_IN_DM_REPLY);
        }

        return;
      }

      if (!hasActiveHandshakeCode(config)) {
        await reply(NO_CODE_PROMPT);

        return;
      }

      if (!looksLikePairingCode(text)) {
        await reply(PAIRING_PROMPT);

        return;
      }

      await onTurnStart?.();
      const result = await verifyAndPairSlackUser(owner, text, event.user);
      await reply(result.message);

      return;
    }

    const [command = ""] = text.startsWith("!")
      ? text.slice(1).split(/\s+/)
      : [];

    if (command === "stop") {
      await reply(
        stopActiveStream(conversationKey) ? "Stopping…" : "Nothing to stop."
      );

      return;
    }

    // A turn holds the conversation lock until it ends, so these commands stop
    // it before queueing on the lock; stopping from inside would never land.
    if (command === "new" || command === "clear") {
      stopActiveStream(conversationKey);
    }

    if (command === "help") {
      await reply(HELP_TEXT);

      return;
    }

    if (command === "org" || command === "profile") {
      await reply(`This connection belongs to agent ${owner.profileId}.`);

      return;
    }

    await chatLock.withLock(conversationKey, async () => {
      // The connection belongs to one agent, so every request is pinned to its
      // org; each event still gets its own client so turns never share one.
      const client = deps.client.forOrg(owner.orgId);

      switch (command) {
        case "": {
          await runTurn(client, event, conversationKey, text, isDm);

          return;
        }

        case "new": {
          await onTurnStart?.();
          await createAndBindSession(client, conversationKey);
          await reply("Started a new conversation.");

          return;
        }

        case "clear": {
          await onTurnStart?.();
          await (await resolveSession(client, conversationKey)).clear();
          await reply("History cleared.");

          return;
        }

        case "status": {
          await reply(await describeStatus(client, conversationKey));

          return;
        }

        default:
          await reply("Unknown command. Send !help for the list.");
      }
    });

    async function describeStatus(
      client: NakamaClient,
      sessionKey: string
    ): Promise<string> {
      try {
        const health = await client.health();

        const lines = [
          `Server: ${health.ok ? "ok" : "degraded"}`,
          `Provider configured: ${health.providerConfigured ? "yes" : "no"}`,
        ];

        const profile = await resolveOwnerProfile(client);
        lines.push(`Agent: ${profile.name}`);

        if (profile?.model) {
          lines.push(`Model: ${profile.model.split("::").pop()}`);
        }

        return lines.join("\n");
      } catch (error) {
        return formatClientError(error);
      }
    }

    async function runTurn(
      client: NakamaClient,
      inbound: SlackMessageEvent,
      sessionKey: string,
      message: string,
      direct: boolean
    ): Promise<void> {
      if (!message) {
        await reply("Send me a message to get started. Try !help.");

        return;
      }

      const session = await resolveSession(client, sessionKey);
      await onTurnStart?.();
      const signal = registerActiveStream(sessionKey);
      let pending = "";
      // Early posts run one after another so their messages stay in order.
      let earlyPosts: Promise<void> = Promise.resolve();
      let postedEarly = false;
      // Reactions need reactions:write; without it the turn still runs.
      await slack
        .addReaction(inbound.channel, inbound.ts, WORKING_REACTION)
        .catch(() => {});

      try {
        const final = await session.sendStream(
          { message: direct ? message : `${CHANNEL_MESSAGE_PREFIX}${message}` },
          {
            onChunk: (delta) => {
              pending += delta;
            },
            // Post what the model said before it reached for tools, so a long
            // tool run does not look like silence.
            onToolStart: () => {
              const early = pending.trim();
              pending = "";

              if (early) {
                postedEarly = true;
                earlyPosts = earlyPosts
                  .then(() => reply(early))
                  .catch((error) => {
                    console.error("Slack early reply failed:", error);
                  });
              }
            },
          },
          { signal }
        );

        // The streamed chunks are the reply; `final` only fills in when none arrived.
        if (!(postedEarly || pending.trim())) {
          pending = final;
        }
      } catch (error) {
        if (!isAbortError(error)) {
          await earlyPosts;
          await reply(formatClientError(error));

          return;
        }
      } finally {
        clearActiveStream(sessionKey, signal);
        await slack
          .removeReaction(inbound.channel, inbound.ts, WORKING_REACTION)
          .catch(() => {});
      }

      await earlyPosts;

      if (pending.trim()) {
        await reply(pending.trim());
      }

      if (signal.aborted) {
        await reply("Stopped.");
      }
    }
  };

  /** The owning agent, or an error when it was deleted after the connection was saved. */
  async function resolveOwnerProfile(client: NakamaClient) {
    const { profiles } = await client.listProfiles(owner.orgId);
    const profile = profiles.find((entry) => entry.id === owner.profileId);

    if (!profile) {
      throw new Error("The connection owner is unavailable.");
    }

    return profile;
  }

  async function resolveSession(
    client: NakamaClient,
    sessionKey: string
  ): Promise<RemoteChatSession> {
    // A session saved for another agent never continues under this one.
    if (sessionStore.get(sessionKey)?.profileId !== owner.profileId) {
      sessionStore.delete(sessionKey);
    }

    const existing = sessionStore.get(sessionKey);

    if (existing) {
      const hot = sessionStore.getHotSession<RemoteChatSession>(sessionKey);

      if (hot) {
        return hot;
      }

      const session = client.createChatSession(existing.sessionId, "slack");

      try {
        await session.getMessages();
        sessionStore.setHotSession(sessionKey, session);

        return session;
      } catch {
        // Session is gone on the server; start a new one below.
      }
    }

    return createAndBindSession(client, sessionKey);
  }

  async function createAndBindSession(
    client: NakamaClient,
    sessionKey: string
  ): Promise<RemoteChatSession> {
    const { id: profileId } = await resolveOwnerProfile(client);
    const session = await client.createSession("slack", { profileId });

    sessionStore.set(sessionKey, {
      profileId,
      sessionId: session.id,
      updatedAt: new Date().toISOString(),
    });
    sessionStore.setHotSession(sessionKey, session);
    await sessionStore.save();

    return session;
  }
}
