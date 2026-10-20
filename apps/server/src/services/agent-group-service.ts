import type { ImageAttachment, OrgRole, ProfileSummary } from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import {
  type AgentGroup,
  type AgentGroupRun,
  type AgentGroupSession,
  type AgentGroupSessionDetail,
  groupSessionTitle,
  memberHandles,
  mentionedMemberIds,
} from "@nakama/core/agent-groups";
import { validateImageAttachments } from "@nakama/core/message-content";
import { filterProfilesForChatAccess } from "@nakama/core/profiles";
import type { DatabaseAdapter } from "@nakama/db";
import { failSubAgentResult } from "../tools/sub-agent-shared";
import { groupMembers, groupTask, transcript } from "./agent-group-prompt";
import {
  appendAgentGroupMessage,
  createAgentGroup,
  createGroupSession,
  deleteAgentGroup,
  deleteAgentGroupAvatar,
  deleteGroupSession,
  getAgentGroup,
  getAgentGroupAvatar,
  getGroupSession,
  listAgentGroupMessages,
  listAgentGroups,
  listGroupSessions,
  type StoredGroupSession,
  setAgentGroupAvatar,
  updateAgentGroup,
  updateGroupSession,
} from "./agent-group-store";
import type { AgentService } from "./agent-service";

/** Agent replies allowed per user message, so two agents cannot loop forever. */
const MAX_GROUP_HOPS = 6;

interface GroupAccess {
  orgRole?: OrgRole;
  profiles: ProfileSummary[];
}

interface ActiveRun extends AgentGroupRun {
  groupId: string;
  hopsLeft: number;
  /** User messages not yet turned into speakers. */
  inbox: string[];
  lastSpeaker: string | null;
  queue: string[];
}

export class AgentGroupService {
  // ponytail: run state lives in this process. A restart ends a run (saved
  // replies stay), and with several server instances behind one URL, Stop and
  // `active` only reach the instance running the turn. Move it to the database
  // when runs must be shared across instances.
  private readonly runs = new Map<string, ActiveRun>();

  constructor(
    private readonly db: Pick<DatabaseAdapter, "getOrgMember" | "getUserById">,
    private readonly agent: Pick<
      AgentService,
      "listProfiles" | "runSubAgentPrompt"
    >
  ) {}

  list(orgId: string, userId: string): AgentGroup[] {
    return listAgentGroups(orgId, userId);
  }

  get(orgId: string, userId: string, groupId: string): AgentGroup {
    return requireGroup(orgId, userId, groupId);
  }

  async create(
    orgId: string,
    userId: string,
    name: string,
    memberIds: string[]
  ): Promise<AgentGroup> {
    await this.assertMembers(orgId, userId, memberIds, []);

    return createAgentGroup(orgId, userId, name, memberIds);
  }

  /** Members kept from before may have lost access; only new ones are checked. */
  async update(
    orgId: string,
    userId: string,
    groupId: string,
    name: string,
    memberIds: string[]
  ): Promise<AgentGroup> {
    const group = requireGroup(orgId, userId, groupId);
    await this.assertMembers(orgId, userId, memberIds, group.memberIds);
    updateAgentGroup(orgId, userId, groupId, name, memberIds);

    return requireGroup(orgId, userId, groupId);
  }

  delete(orgId: string, userId: string, groupId: string): void {
    if (!deleteAgentGroup(orgId, userId, groupId)) {
      throw new NakamaApiError("Group not found", 404);
    }

    for (const run of this.runs.values()) {
      if (run.groupId === groupId) {
        halt(run);
      }
    }
  }

  setAvatar(
    orgId: string,
    userId: string,
    groupId: string,
    image: ImageAttachment
  ): void {
    validateImageAttachments([image]);

    const base64 = image.data.includes(",")
      ? (image.data.split(",")[1] ?? "")
      : image.data;

    if (
      !setAgentGroupAvatar(
        orgId,
        userId,
        groupId,
        image.mediaType,
        Buffer.from(base64, "base64")
      )
    ) {
      throw new NakamaApiError("Group not found", 404);
    }
  }

  avatar(
    orgId: string,
    userId: string,
    groupId: string
  ): { bytes: Uint8Array; mediaType: string } {
    const avatar = getAgentGroupAvatar(orgId, userId, groupId);

    if (!avatar) {
      throw new NakamaApiError("Group image not found", 404);
    }

    return avatar;
  }

  removeAvatar(orgId: string, userId: string, groupId: string): void {
    requireGroup(orgId, userId, groupId);
    deleteAgentGroupAvatar(orgId, userId, groupId);
  }

  sessions(
    orgId: string,
    userId: string,
    groupId: string
  ): AgentGroupSession[] {
    requireGroup(orgId, userId, groupId);

    return listGroupSessions(orgId, userId, groupId).map((session) =>
      this.withActive(session)
    );
  }

  session(
    orgId: string,
    userId: string,
    groupId: string,
    sessionId: string
  ): AgentGroupSessionDetail {
    const group = requireGroup(orgId, userId, groupId);
    const session = requireSession(orgId, userId, groupId, sessionId);
    const run = this.runs.get(sessionId);

    return {
      group,
      messages: listAgentGroupMessages(orgId, sessionId),
      run: run
        ? {
            activity: run.activity,
            speakerProfileId: run.speakerProfileId,
            stopping: run.stopping,
          }
        : null,
      session: this.withActive(session),
    };
  }

  /**
   * Opens a session with its first message and starts the reply run. The
   * session is returned at once; the run comes back as `run` for the caller.
   */
  start(orgId: string, userId: string, groupId: string, content: string) {
    requireGroup(orgId, userId, groupId);

    const session = createGroupSession(
      orgId,
      groupId,
      groupSessionTitle(content)
    );

    const run = this.post(orgId, userId, groupId, session.id, content);

    return { run, session: this.withActive(session) };
  }

  updateSession(
    orgId: string,
    userId: string,
    groupId: string,
    sessionId: string,
    changes: { pinned?: boolean; title?: string }
  ): void {
    if (!updateGroupSession(orgId, userId, groupId, sessionId, changes)) {
      throw new NakamaApiError("Session not found", 404);
    }
  }

  deleteSession(
    orgId: string,
    userId: string,
    groupId: string,
    sessionId: string
  ): void {
    if (!deleteGroupSession(orgId, userId, groupId, sessionId)) {
      throw new NakamaApiError("Session not found", 404);
    }

    this.stopRun(sessionId);
  }

  stop(
    orgId: string,
    userId: string,
    groupId: string,
    sessionId: string
  ): void {
    requireSession(orgId, userId, groupId, sessionId);
    this.stopRun(sessionId);
  }

  /**
   * Saves the user message. With agents already replying it joins that run,
   * so the user can keep talking; otherwise it starts a run and returns it.
   * Synchronous up to `runs.set`, so two posts cannot start two runs.
   */
  post(
    orgId: string,
    userId: string,
    groupId: string,
    sessionId: string,
    content: string
  ): Promise<void> {
    const session = requireSession(orgId, userId, groupId, sessionId);
    const active = this.runs.get(sessionId);

    if (active) {
      appendAgentGroupMessage(orgId, session, null, content);
      active.inbox.push(content);
      // A new message outranks an earlier Stop.
      active.stopping = false;

      return Promise.resolve();
    }

    const run: ActiveRun = {
      activity: null,
      groupId,
      hopsLeft: 0,
      inbox: [content],
      lastSpeaker:
        listAgentGroupMessages(orgId, sessionId).findLast(
          (message) => message.authorProfileId !== null
        )?.authorProfileId ?? null,
      queue: [],
      speakerProfileId: null,
      stopping: false,
    };

    this.runs.set(sessionId, run);

    try {
      appendAgentGroupMessage(orgId, session, null, content);
    } catch (error) {
      this.runs.delete(sessionId);
      throw error;
    }

    return this.reply(orgId, userId, session, run).finally(() => {
      if (this.runs.get(sessionId) === run) {
        this.runs.delete(sessionId);
      }
    });
  }

  private async reply(
    orgId: string,
    userId: string,
    session: StoredGroupSession,
    run: ActiveRun
  ): Promise<void> {
    for (;;) {
      // Re-read every hop: the group may be edited or deleted, and sharing or
      // membership may change mid-run.
      const group = getAgentGroup(orgId, userId, session.groupId);
      const access = await this.access(orgId, userId);
      const members = group ? groupMembers(group, access.profiles) : [];
      const handles = memberHandles(members);

      for (const message of run.inbox.splice(0)) {
        const mentioned = mentionedMemberIds(message, handles);

        // Everyone the user named gets a turn, even past the cap (`@all`).
        run.hopsLeft = Math.max(MAX_GROUP_HOPS, mentioned.length);

        const fallback =
          members.find((p) => p.id === run.lastSpeaker) ?? members[0];

        enqueue(
          run.queue,
          mentioned.length > 0 ? mentioned : fallback ? [fallback.id] : []
        );
      }

      const profileId = run.queue.shift();

      // Decided and cleared in one synchronous step, so a post() can never
      // land in a run that has already finished.
      if (!group || run.stopping || !profileId || run.hopsLeft <= 0) {
        this.runs.delete(session.id);

        return;
      }

      run.hopsLeft -= 1;
      const speaker = members.find((p) => p.id === profileId);

      if (!speaker) {
        appendAgentGroupMessage(
          orgId,
          session,
          profileId,
          "_Skipped: no access_"
        );
        continue;
      }

      run.speakerProfileId = profileId;
      run.activity = null;

      // ponytail: Stop and the hop timeout cannot abort a running hop, add an
      // AbortSignal to SubAgentRunInput if that cost matters.
      const result = await this.agent
        .runSubAgentPrompt({
          agentDepth: 1,
          context: transcript(orgId, session.id, handles, members),
          onActivity: (label) => {
            run.activity = label;
          },
          orgId,
          orgRole: access.orgRole,
          profileId,
          task: groupTask(group, speaker, handles),
          userId,
        })
        .catch((error) =>
          failSubAgentResult(
            error instanceof Error ? error.message : String(error)
          )
        );

      const text = result.output.trim();

      appendAgentGroupMessage(
        orgId,
        session,
        profileId,
        result.status === "success" && text
          ? text
          : `_${result.error ?? "No reply."}_`
      );
      run.lastSpeaker = profileId;
      enqueue(run.queue, mentionedMemberIds(text, handles, profileId));
    }
  }

  private async assertMembers(
    orgId: string,
    userId: string,
    memberIds: string[],
    kept: string[]
  ): Promise<void> {
    if (new Set(memberIds).size !== memberIds.length) {
      throw new NakamaApiError("Each agent can join a group once.", 400);
    }

    const { profiles } = await this.access(orgId, userId);

    const allowed = memberIds.every(
      (id) => kept.includes(id) || profiles.some((p) => p.id === id)
    );

    if (!allowed) {
      throw new NakamaApiError("You cannot use one of these agents.", 403);
    }
  }

  /** The agents this user may chat with right now; none once they leave the org. */
  private async access(orgId: string, userId: string): Promise<GroupAccess> {
    const [member, user] = await Promise.all([
      this.db.getOrgMember(orgId, userId),
      this.db.getUserById(userId),
    ]);

    if (!(member && user) || user.disabledAt) {
      return { profiles: [] };
    }

    const { profiles } = await this.agent.listProfiles(orgId);

    return {
      orgRole: member.role,
      profiles: filterProfilesForChatAccess(profiles, {
        excludeSuperNakama: true,
        isPlatformAdmin: user.isPlatformAdmin === true,
        orgRole: member.role,
        userId,
      }),
    };
  }

  private withActive(session: StoredGroupSession): AgentGroupSession {
    return { ...session, active: this.runs.has(session.id) };
  }

  private stopRun(sessionId: string): void {
    const run = this.runs.get(sessionId);

    if (run) {
      halt(run);
    }
  }
}

/**
 * Drops the queued speakers with the flag, so a message sent after Stop
 * wakes only the agents it mentions.
 */
function halt(run: ActiveRun): void {
  run.stopping = true;
  run.queue.length = 0;
  run.inbox.length = 0;
}

function enqueue(queue: string[], ids: string[]): void {
  for (const id of ids) {
    if (!queue.includes(id)) {
      queue.push(id);
    }
  }
}

function requireGroup(
  orgId: string,
  userId: string,
  groupId: string
): AgentGroup {
  const group = getAgentGroup(orgId, userId, groupId);

  if (!group) {
    throw new NakamaApiError("Group not found", 404);
  }

  return group;
}

function requireSession(
  orgId: string,
  userId: string,
  groupId: string,
  sessionId: string
): StoredGroupSession {
  const session = getGroupSession(orgId, userId, groupId, sessionId);

  if (!session) {
    throw new NakamaApiError("Session not found", 404);
  }

  return session;
}
