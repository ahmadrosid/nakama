import type { NakamaClient, RemoteChatSession } from "@nakama/client";
import { splitTelegramChunks } from "@nakama/core";
import { formatClientError } from "@nakama/core/api-error";
import { createChatLock } from "@nakama/core/channel-chat-lock";
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

      return;
    }

    if (!allows(config, activity)) {
      return;
    }

    await chatLock.withLock(sessionKey, async () => {
      // Read again: the turn may have waited behind a long one, and the
      // administrator may have removed this user in the meantime.
      if (!allows(await loadConfig(), activity)) {
        return;
      }

      let reply: string;

      try {
        // Every request for this chat runs as the owning organization.
        const session = await resolveSession(
          client.forOrg(owner.orgId),
          sessionKey
        );

        reply = await session.send({ message: activity.text.trim() });
      } catch (error) {
        // The sender passed every access check, so they hear why nothing came.
        reply = formatClientError(error);
      }

      for (const chunk of splitTelegramChunks(reply, TEAMS_MAX_MESSAGE_CHARS)) {
        await send(activity.conversationId, chunk);
      }
    });
  };
}
