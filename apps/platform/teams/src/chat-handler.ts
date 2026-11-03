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
  type ChannelCommand,
  channelCommandHelp,
  describeChannelStatus,
  parseChannelCommand,
  runChannelCommand,
} from "@nakama/core/channel-commands";
import {
  type ChannelOwner,
  looksLikePairingCode,
} from "@nakama/core/channel-config-shared";
import type { ChannelSessionStore } from "@nakama/core/channel-session-store";
import {
  isTeamsUserAuthorized,
  type TeamsConfigFile,
  verifyAndPairTeamsUser,
} from "@nakama/core/teams-config";

/** The parts of a Teams message activity this slice acts on. */
export interface TeamsActivity {
  /** The Bot Framework channel; only "msteams" is served. */
  channelId: string;
  conversationId: string;
  /** "personal" is a one-to-one chat; group chats and channels are ignored. */
  conversationType: string;
  id: string;
  isBot: boolean;
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
const COMMAND_PREFIX = "!";

const HELP_TEXT = `Chat with me in this chat.\n\n${channelCommandHelp(COMMAND_PREFIX)}`;

function isPersonalMessage(activity: TeamsActivity): boolean {
  return (
    activity.channelId === "msteams" &&
    activity.conversationType === "personal" &&
    !activity.isBot &&
    activity.text.trim().length > 0 &&
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
    await sessionStore.save();

    return session;
  }

  async function reply(conversationId: string, text: string): Promise<void> {
    for (const chunk of splitTelegramChunks(text, TEAMS_MAX_MESSAGE_CHARS)) {
      await send(conversationId, chunk);
    }
  }

  function describeStatus(sessionKey: string): Promise<string> {
    const scoped = client.forOrg(owner.orgId);

    return describeChannelStatus(scoped, {
      findAgent: async () => {
        const { profiles } = await scoped.listProfiles(owner.orgId);

        return {
          agent: profiles.find((entry) => entry.id === owner.profileId),
          id: owner.profileId,
        };
      },
      label: "Agent",
      sessionId: sessionStore.get(sessionKey)?.sessionId,
    });
  }

  /** Answers a "!word" message. It never reaches the agent as a turn. */
  function handleCommand(
    command: ChannelCommand,
    activity: TeamsActivity,
    sessionKey: string
  ): Promise<void> {
    const scoped = client.forOrg(owner.orgId);

    return runChannelCommand(command, {
      clearSession: async () => {
        await (await resolveSession(scoped, sessionKey)).clear();
      },
      helpText: HELP_TEXT,
      reply: (text) => reply(activity.conversationId, text),
      runLocked: (work) =>
        chatLock.withLock(sessionKey, async () => {
          if (!allows(await loadConfig(), activity)) {
            return;
          }

          try {
            await work();
          } catch (error) {
            await reply(activity.conversationId, formatClientError(error));
          }
        }),
      startSession: async () => {
        await createAndBindSession(scoped, sessionKey);
      },
      status: () => describeStatus(sessionKey),
      // Both are called, so the running turn and the queued ones all stop.
      stop: () => {
        const stoppedWaiting = stopWaitingTurns(sessionKey);
        const stoppedRunning = stopActiveStream(sessionKey);

        return stoppedWaiting || stoppedRunning;
      },
      stopRunning: () => {
        stopActiveStream(sessionKey);
      },
    });
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
          { message: text },
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

  return async function handle(activity: TeamsActivity): Promise<void> {
    if (!isPersonalMessage(activity)) {
      return;
    }

    // Checked before the first await so a retry that arrives while the first
    // delivery is still running cannot start a second turn. Ids are unique
    // within a chat; one without an id cannot be told apart from a retry.
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

    const sessionKey = `teams:${activity.conversationId}`;
    const text = activity.text.trim();
    const command = parseChannelCommand(text, COMMAND_PREFIX);

    if (!allows(config, activity)) {
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
