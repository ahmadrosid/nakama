import type { NakamaClient, RemoteChatSession } from "@nakama/client";
import { createChatLock } from "@nakama/core/channel-chat-lock";
import type { ChannelOwner } from "@nakama/core/channel-config-shared";
import type { ChannelSessionStore } from "@nakama/core/channel-session-store";
import type { TeamsConfigFile } from "@nakama/core/teams-config";

/** The parts of a Teams message activity this slice acts on. */
export interface TeamsActivity {
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

function isPersonalMessage(activity: TeamsActivity): boolean {
  return (
    activity.conversationType === "personal" &&
    !activity.isBot &&
    activity.text.trim().length > 0 &&
    activity.conversationId.trim().length > 0
  );
}

/** An empty allowlist denies everyone, which is what an unset one means. */
function allows(
  config: TeamsConfigFile | null,
  activity: TeamsActivity
): boolean {
  return (
    config !== null &&
    config.tenantId === activity.tenantId &&
    config.allowedUserIds.includes(activity.senderId)
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
    // delivery is still running cannot start a second turn.
    if (seenActivities.has(activity.id)) {
      return;
    }

    seenActivities.add(activity.id);

    if (seenActivities.size > SEEN_ACTIVITY_LIMIT) {
      const oldest = seenActivities.values().next().value;

      if (oldest !== undefined) {
        seenActivities.delete(oldest);
      }
    }

    if (!allows(await loadConfig(), activity)) {
      return;
    }

    const sessionKey = `teams:${activity.conversationId}`;

    await chatLock.withLock(sessionKey, async () => {
      // Read again: the turn may have waited behind a long one, and the
      // administrator may have removed this user in the meantime.
      if (!allows(await loadConfig(), activity)) {
        return;
      }

      // Every request for this chat runs as the owning organization.
      const session = await resolveSession(
        client.forOrg(owner.orgId),
        sessionKey
      );

      const reply = await session.send({ message: activity.text.trim() });

      if (reply.trim()) {
        await send(activity.conversationId, reply);
      }
    });
  };
}
