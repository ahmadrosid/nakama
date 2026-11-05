import type { NakamaClient, RemoteChatSession } from "@nakama/client";
import { splitTelegramChunks } from "@nakama/core";
import { formatClientError } from "@nakama/core/api-error";
import {
  clearActiveStream,
  isAbortError,
  registerActiveStream,
  stopActiveStream,
} from "@nakama/core/channel-active-stream";
import { createChatLock } from "@nakama/core/channel-chat-lock";
import {
  type ChannelOwner,
  containsPairingCode,
  hasActiveHandshakeCode,
  looksLikePairingCode,
} from "@nakama/core/channel-config-shared";
import type { ChannelSessionStore } from "@nakama/core/channel-session-store";
import {
  isTeamsUserAuthorized,
  spendExposedTeamsHandshake,
  type TeamsConfigFile,
  verifyAndPairTeamsUser,
} from "@nakama/core/teams-config";

/** The parts of a Teams message activity this slice acts on. */
export interface TeamsActivity {
  /** The Bot Framework channel; only "msteams" is served. */
  channelId: string;
  conversationId: string;
  /**
   * "personal" is a one-to-one chat. In a "channel" the id names one thread
   * (`...;messageid=<root>`). Group chats are ignored.
   */
  conversationType: string;
  id: string;
  isBot: boolean;
  /** The activity at-mentions this bot; a channel message is served only then. */
  mentionsBot: boolean;
  /** The sender's Entra object id, which the allowlist is written against. */
  senderId: string;
  tenantId: string;
  text: string;
}

export interface TeamsChatHandlerDeps {
  client: NakamaClient;
  /** Read per turn, so an administrator's change applies to queued work. */
  loadConfig: () => Promise<TeamsConfigFile | null>;
  owner: ChannelOwner;
  send: (conversationId: string, text: string) => Promise<void>;
  sessionStore: ChannelSessionStore;
}

const chatLock = createChatLock({ waitMs: 15 * 60 * 1000 });

/** Teams retries an activity it thinks was not acknowledged. */
const SEEN_ACTIVITY_LIMIT = 500;

/**
 * Teams refuses a message of about 28 KB. Even at four bytes a character this
 * stays under it, with room for the activity around the text.
 */
const TEAMS_MAX_MESSAGE_CHARS = 6000;

// "!" and not "/": typing "/" in Teams opens its own command menu.
const HELP_TEXT = [
  "Chat with me in this chat.",
  "In a channel, @mention me in a thread. I read only the message that mentions me, not the rest of the thread.",
  "",
  "!new: start a fresh conversation",
  "!clear: clear this conversation's history",
  "!stop: stop the current reply",
  "!status: server and model status (personal chat only)",
  "!help: this message",
].join("\n");

const CHANNEL_MESSAGE_PREFIX =
  "[Teams channel thread. Your reply is visible to everyone in this channel.]\n";

// Pairing codes stay out of channels: anyone reading could use the code first.
const LINK_IN_PERSONAL_CHAT_REPLY =
  "I can't answer you yet. Link your account first: open a personal chat with me and send the pairing code from Connections → Teams there.";

// True also when the spend failed: making a new code replaces the posted one.
const CODE_EXPOSED_REPLY =
  "Everyone in this channel can read that pairing code. Make a new one in Connections → Teams and send it to me in a personal chat.";

const THREAD_SESSION_PREFIX = "teams-thread:";

/**
 * Every channel thread and sender gets a session that never ends, so only this
 * many are kept. At about 150 bytes a record, they add at most about 75 KB to
 * the chat-sessions.json that each new session rewrites.
 */
const MAX_THREAD_SESSIONS = 500;

const COMMANDS = ["clear", "help", "new", "status", "stop"] as const;

type TeamsCommand = (typeof COMMANDS)[number];

/**
 * "!New please" is "new". Any other message is null and goes to the agent,
 * "!urgent summarise the report" included.
 */
function parseCommand(text: string): TeamsCommand | null {
  if (!text.startsWith("!")) {
    return null;
  }

  // Phone keyboards capitalise the first letter of a message.
  const word = (text.slice(1).split(/\s+/)[0] ?? "").toLowerCase();

  return COMMANDS.find((command) => command === word) ?? null;
}

function isPersonal(activity: TeamsActivity): boolean {
  return activity.conversationType === "personal";
}

/**
 * A personal chat, or a channel thread message that mentions the bot. A bare
 * mention is served too, so the sender hears how to start.
 */
function isServedMessage(activity: TeamsActivity): boolean {
  return (
    activity.channelId === "msteams" &&
    (isPersonal(activity) ||
      (activity.conversationType === "channel" && activity.mentionsBot)) &&
    !activity.isBot &&
    (activity.mentionsBot || activity.text.trim().length > 0) &&
    activity.conversationId.trim().length > 0
  );
}

/**
 * Entra ids are GUIDs, which compare without regard to letter case.
 */
function allows(
  config: TeamsConfigFile | null,
  activity: TeamsActivity
): boolean {
  return (
    config !== null &&
    config.tenantId.toLowerCase() === activity.tenantId.toLowerCase() &&
    isTeamsUserAuthorized(activity.senderId, config)
  );
}

export function createTeamsChatHandler(deps: TeamsChatHandlerDeps) {
  const { client, loadConfig, owner, send, sessionStore } = deps;
  const seenActivities = new Set<string>();
  // Each turn from the moment it queues until the active-stream registry knows
  // it, which is only once it holds the chat lock, so !stop reaches the
  // waiting ones through this map.
  const waitingTurns = new Map<string, Set<AbortController>>();

  function stopWaitingTurns(sessionKey: string): boolean {
    const waiting = waitingTurns.get(sessionKey);

    for (const turn of waiting ?? []) {
      turn.abort();
    }

    waitingTurns.delete(sessionKey);

    return (waiting?.size ?? 0) > 0;
  }

  function leaveWaiting(sessionKey: string, turn: AbortController): void {
    const waiting = waitingTurns.get(sessionKey);

    waiting?.delete(turn);

    if (waiting?.size === 0) {
      waitingTurns.delete(sessionKey);
    }
  }

  async function resolveSession(
    scoped: NakamaClient,
    sessionKey: string
  ): Promise<RemoteChatSession> {
    // A session saved for another agent never continues under this one.
    if (sessionStore.get(sessionKey)?.profileId !== owner.profileId) {
      sessionStore.delete(sessionKey);
    }

    const existing = sessionStore.get(sessionKey);

    if (existing) {
      // Kept in memory only: the next save writes it. The thread cap drops the
      // sessions used longest ago, not the ones made first.
      sessionStore.set(sessionKey, {
        ...existing,
        updatedAt: new Date().toISOString(),
      });

      const hot = sessionStore.getHotSession<RemoteChatSession>(sessionKey);

      if (hot) {
        return hot;
      }

      const session = scoped.createChatSession(existing.sessionId, "teams");

      try {
        await session.getMessages();
        sessionStore.setHotSession(sessionKey, session);

        return session;
      } catch {
        // The server no longer has it; fall through and start a new one.
      }
    }

    return createAndBindSession(scoped, sessionKey);
  }

  async function createAndBindSession(
    scoped: NakamaClient,
    sessionKey: string
  ): Promise<RemoteChatSession> {
    const session = await scoped.createSession("teams", {
      profileId: owner.profileId,
    });

    sessionStore.set(sessionKey, {
      profileId: owner.profileId,
      sessionId: session.id,
      updatedAt: new Date().toISOString(),
    });
    sessionStore.setHotSession(sessionKey, session);

    if (sessionKey.startsWith(THREAD_SESSION_PREFIX)) {
      sessionStore.dropOldest(THREAD_SESSION_PREFIX, MAX_THREAD_SESSIONS);
    }

    await sessionStore.save();

    return session;
  }

  async function reply(conversationId: string, text: string): Promise<void> {
    for (const chunk of splitTelegramChunks(text, TEAMS_MAX_MESSAGE_CHARS)) {
      await send(conversationId, chunk);
    }
  }

  async function describeStatus(sessionKey: string): Promise<string> {
    try {
      const scoped = client.forOrg(owner.orgId);
      const health = await scoped.health();

      const lines = [
        `Server: ${health.ok ? "ok" : "degraded"}`,
        `Provider configured: ${health.providerConfigured ? "yes" : "no"}`,
      ];

      if (health.providerConfigured) {
        const [models, { profiles }] = await Promise.all([
          scoped.getModels(),
          scoped.listProfiles(owner.orgId),
        ]);

        const profile = profiles.find((entry) => entry.id === owner.profileId);

        const modelLabel = profile?.model?.includes("::")
          ? profile.model.slice(profile.model.indexOf("::") + 2)
          : (profile?.model ?? "none");

        lines.push(`Agent: ${profile?.name ?? owner.profileId}`);
        lines.push(`Provider: ${models.provider ?? "unknown"}`);
        lines.push(`Model: ${modelLabel}`);
      } else {
        lines.push("Chat runs in offline mode without an API key.");
      }

      const sessionId = sessionStore.get(sessionKey)?.sessionId;

      if (sessionId) {
        lines.push(`Session: ${sessionId.slice(0, 8)}`);
      }

      return lines.join("\n");
    } catch (error) {
      return formatClientError(error);
    }
  }

  /** Answers a "!word" message. It never reaches the agent as a turn. */
  async function handleCommand(
    command: TeamsCommand,
    activity: TeamsActivity,
    sessionKey: string
  ): Promise<void> {
    const answer = (text: string) => reply(activity.conversationId, text);

    switch (command) {
      case "stop": {
        // Not behind the lock: the turn it stops is holding it. Both are
        // called, so the running turn and the queued ones all stop.
        const stoppedWaiting = stopWaitingTurns(sessionKey);
        const stoppedRunning = stopActiveStream(sessionKey);

        await answer(
          stoppedWaiting || stoppedRunning ? "Stopping…" : "Nothing to stop."
        );

        return;
      }

      case "help": {
        await answer(HELP_TEXT);

        return;
      }

      case "status": {
        // Everyone in a channel would read the agent, model and session.
        await answer(
          isPersonal(activity)
            ? await describeStatus(sessionKey)
            : "Send !status to me in a personal chat."
        );

        return;
      }

      case "new":
      case "clear": {
        // A turn holds the chat lock until it ends, so stop it before
        // queueing on the lock; otherwise this waits for the whole turn.
        stopActiveStream(sessionKey);

        await chatLock.withLock(sessionKey, async () => {
          if (!allows(await loadConfig(), activity)) {
            return;
          }

          try {
            const scoped = client.forOrg(owner.orgId);

            if (command === "new") {
              await createAndBindSession(scoped, sessionKey);
              await answer("Started a new conversation.");
            } else {
              await (await resolveSession(scoped, sessionKey)).clear();
              await answer("History cleared.");
            }
          } catch (error) {
            await answer(formatClientError(error));
          }
        });

        return;
      }
    }
  }

  async function runTurn(
    activity: TeamsActivity,
    sessionKey: string,
    text: string,
    signal: AbortSignal
  ): Promise<void> {
    let streamed = "";
    let answer = "";
    let stopped = signal.aborted;

    try {
      // A turn stopped while it waited creates no session.
      if (!stopped) {
        // Every request for this chat runs as the owning organization.
        const session = await resolveSession(
          client.forOrg(owner.orgId),
          sessionKey
        );

        // Streamed so the turn can be aborted and the text before a stop is
        // kept; the reply is still sent only once the turn ends.
        answer = await session.sendStream(
          {
            message: isPersonal(activity)
              ? text
              : `${CHANNEL_MESSAGE_PREFIX}${text}`,
          },
          (delta) => {
            streamed += delta;
          },
          { signal }
        );
      }
    } catch (error) {
      // The sender passed every access check, so they hear why nothing came.
      // Only the abort a stop caused is quiet; any other failure is told, a
      // server error that lands during a stop included.
      stopped = signal.aborted && isAbortError(error);
      answer = stopped ? streamed : formatClientError(error);
    } finally {
      clearActiveStream(sessionKey, signal);
    }

    if (answer.trim()) {
      await reply(activity.conversationId, answer);
    }

    if (stopped) {
      await reply(activity.conversationId, "Stopped.");
    }
  }

  /**
   * True when the message carried the live code, also when the spend failed:
   * the message is still turned away, so the code never reaches the agent.
   * A failed spend leaves the code live, so that is logged, not hidden.
   */
  async function spendExposedCode(
    text: string,
    config: TeamsConfigFile
  ): Promise<boolean> {
    // Most messages carry no code, so they skip the pairing lock.
    if (
      !(
        config.handshakeCode &&
        hasActiveHandshakeCode(config) &&
        containsPairingCode(text, config.handshakeCode)
      )
    ) {
      return false;
    }

    try {
      // False when the code was spent or replaced since the config was read.
      await spendExposedTeamsHandshake(text, owner);
    } catch (error) {
      console.error(
        "[teams] could not spend a pairing code posted in a channel:",
        error instanceof Error ? error.message : String(error)
      );
    }

    return true;
  }

  return async function handle(activity: TeamsActivity): Promise<void> {
    if (!isServedMessage(activity)) {
      return;
    }

    // Checked before the first await so a retry that arrives while the first
    // delivery is still running cannot start a second turn. Ids are unique
    // within a chat or thread; one without an id cannot be told apart from a
    // retry.
    const deliveryKey = activity.id
      ? `${activity.conversationId}:${activity.id}`
      : null;

    if (deliveryKey !== null) {
      if (seenActivities.has(deliveryKey)) {
        return;
      }

      seenActivities.add(deliveryKey);

      if (seenActivities.size > SEEN_ACTIVITY_LIMIT) {
        const oldest = seenActivities.values().next().value;

        if (oldest !== undefined) {
          seenActivities.delete(oldest);
        }
      }
    }

    const config = await loadConfig();

    if (
      !config ||
      config.tenantId.toLowerCase() !== activity.tenantId.toLowerCase()
    ) {
      return;
    }

    // In a channel each sender has their own session in the thread: messages
    // do not say who sent them, and one user's !stop, !new or !clear must not
    // reach another's turn.
    const sessionKey = isPersonal(activity)
      ? `teams:${activity.conversationId}`
      : `${THREAD_SESSION_PREFIX}${activity.conversationId}:${activity.senderId.toLowerCase()}`;

    const text = activity.text.trim();
    const command = parseCommand(text);

    // Everyone in the channel read the code, so it no longer pairs anyone,
    // whoever posted it. It never reaches the agent, which could repeat it.
    if (!isPersonal(activity) && (await spendExposedCode(text, config))) {
      await send(
        activity.conversationId,
        allows(config, activity)
          ? CODE_EXPOSED_REPLY
          : LINK_IN_PERSONAL_CHAT_REPLY
      );

      return;
    }

    if (!allows(config, activity)) {
      if (!isPersonal(activity)) {
        await send(activity.conversationId, LINK_IN_PERSONAL_CHAT_REPLY);

        return;
      }

      // Only an unauthorized sender's code-shaped message is a pairing attempt.
      if (looksLikePairingCode(activity.text)) {
        await chatLock.withLock(sessionKey, async () => {
          const result = await verifyAndPairTeamsUser(
            activity.text,
            activity.senderId,
            activity.tenantId,
            owner
          );

          await send(activity.conversationId, result.message);
        });
      }

      return;
    }

    if (!text) {
      await reply(
        activity.conversationId,
        "Send me a message to get started. Try !help."
      );

      return;
    }

    if (command !== null) {
      await handleCommand(command, activity, sessionKey);

      return;
    }

    const queued = new AbortController();
    const waiting = waitingTurns.get(sessionKey) ?? new Set<AbortController>();

    waiting.add(queued);
    waitingTurns.set(sessionKey, waiting);

    try {
      await chatLock.withLock(sessionKey, async () => {
        // Read again: the turn may have waited behind a long one, and the
        // administrator may have removed this user in the meantime.
        if (!allows(await loadConfig(), activity)) {
          return;
        }

        // Registered before the next await, so !stop reaches the turn through
        // the registry from here on. A stop that came while it waited is
        // carried over.
        const signal = registerActiveStream(sessionKey);

        // Left here, not when the turn ends: a !stop that comes while the
        // finished answer is still being posted has nothing to stop.
        leaveWaiting(sessionKey, queued);

        if (queued.signal.aborted) {
          stopActiveStream(sessionKey);
        }

        await runTurn(activity, sessionKey, text, signal);
      });
    } finally {
      // A turn turned away at the lock, or one whose access read failed.
      leaveWaiting(sessionKey, queued);
    }
  };
}
