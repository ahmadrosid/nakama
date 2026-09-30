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
import {
  isSlackUserAuthorized,
  isSlackWorkspaceMember,
  loadSlackConfigFile,
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

function looksLikePairingCode(text: string): boolean {
  return /^[0-9A-F]{8}$/i.test(text.replace(/\s+/g, ""));
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

  return async function handleEvent(event: SlackMessageEvent): Promise<void> {
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
      return;
    }

    const isDm = event.channel_type === "im";
    const raw = event.text ?? "";
    const text = normalizeSlackText(raw, botUserId);
    const threadTs = isDm ? event.thread_ts : (event.thread_ts ?? event.ts);
    const conversationKey = isDm
      ? event.channel
      : `${event.channel}:${threadTs}`;

    // In channels: an @mention opens a thread; after that the bot follows the thread.
    if (
      !(
        isDm ||
        raw.includes(`<@${botUserId}>`) ||
        (event.thread_ts && sessionStore.get(conversationKey))
      )
    ) {
      return;
    }

    const reply = (message: string) =>
      slack.postMessage(event.channel, message, threadTs);
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
      if (!config?.handshakeCode) {
        await reply(NO_CODE_PROMPT);
        return;
      }
      if (!looksLikePairingCode(text)) {
        await reply(PAIRING_PROMPT);
        return;
      }
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
          await createAndBindSession(client, conversationKey);
          await reply("Started a new conversation.");
          return;
        }
        case "clear": {
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
