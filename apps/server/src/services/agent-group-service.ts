import type { ImageAttachment, OrgRole, ProfileSummary } from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import {
  type AgentGroup,
  type AgentGroupMessage,
  type AgentGroupRun,
  type AgentGroupSession,
  type AgentGroupSessionDetail,
  type AgentGroupThreadDetail,
  assignHandles,
  type GroupRoster,
  groupRoster,
  groupSessionTitle,
} from "@nakama/core/agent-groups";
import { validateImageAttachments } from "@nakama/core/message-content";
import { filterProfilesForChatAccess } from "@nakama/core/profiles";
import type { DatabaseAdapter } from "@nakama/db";
import {
  requireGroup,
  requireSession,
  requireThreadRoot,
} from "./agent-group-lookup";
import {
  addAgentGroupHandles,
  appendAgentGroupMessage,
  createAgentGroup,
  createGroupSession,
  deleteAgentGroup,
  deleteAgentGroupAvatar,
  deleteGroupSession,
  getAgentGroup,
  getAgentGroupAvatar,
  listAgentGroupMessages,
  listAgentGroups,
  listAgentGroupThreadMessages,
  listGroupSessionImages,
  listGroupSessions,
  type StoredGroupSession,
  setAgentGroupAvatar,
  updateAgentGroup,
  updateGroupSession,
} from "./agent-group-store";
import { retitleGroupSession } from "./agent-group-title";
import { addressedMembers, takeGroupTurn } from "./agent-group-turn";
import { type PostedDocument, workspaceOfGroup } from "./agent-group-workspace";
import type { AgentService } from "./agent-service";

/** Agent replies allowed per user message, so two agents cannot loop forever. */
const MAX_GROUP_HOPS = 6;

interface GroupAccess {
  orgRole?: OrgRole;
  profiles: ProfileSummary[];
}

interface ActiveRun extends AgentGroupRun {
  groupId: string;
  /** Aborts the hop in progress. */
  hop: AbortController | null;
  hopsLeft: number;
  /** User messages not yet turned into speakers. */
  inbox: string[];
  lastSpeaker: string | null;
  queue: string[];
  steps: string[];
  text: string;
  /** The session title being generated from the first reply. */
  titling: Promise<void> | null;
}

/** An agent answering the user in one thread; at most one per thread. */
interface ThreadRun extends AgentGroupRun {
  /** The user wrote again while the agent was replying. */
  again: boolean;
  /** Aborts the reply in progress. */
  hop: AbortController | null;
}

export class AgentGroupService {
  // ponytail: run state lives in this process. A restart ends a run (saved
  // replies stay), and with several server instances behind one URL, Stop and
  // `active` only reach the instance running the turn. Move it to the database
  // when runs must be shared across instances.
  private readonly runs = new Map<string, ActiveRun>();

  /** Thread runs, keyed by `sessionId:rootId`. */
  private readonly threadRuns = new Map<string, ThreadRun>();

  constructor(
    private readonly db: Pick<DatabaseAdapter, "getOrgMember" | "getUserById">,
    private readonly agent: Pick<
      AgentService,
      "generateSessionTitle" | "listProfiles" | "runGroupTurn"
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
    memberIds: string[],
    brief = ""
  ): Promise<AgentGroup> {
    const handles = await this.assertMembers(orgId, userId, memberIds, {});

    return createAgentGroup(orgId, userId, name, memberIds, brief, handles);
  }

  /** Members kept from before may have lost access; only new ones are checked. */
  async update(
    orgId: string,
    userId: string,
    groupId: string,
    name: string,
    memberIds: string[],
    brief = ""
  ): Promise<AgentGroup> {
    const group = requireGroup(orgId, userId, groupId);
    const handles = await this.assertMembers(orgId, userId, memberIds, group);
    updateAgentGroup(orgId, userId, groupId, name, memberIds, brief, handles);

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

    workspaceOfGroup(orgId, groupId).remove();
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
            steps: run.steps,
            stopping: run.stopping,
            text: run.text,
          }
        : null,
      session: this.withActive(session),
      threadRunIds: [...this.threadRuns.keys()].flatMap((key) =>
        key.startsWith(`${sessionId}:`)
          ? [Number(key.slice(sessionId.length + 1))]
          : []
      ),
    };
  }

  thread(
    orgId: string,
    userId: string,
    groupId: string,
    sessionId: string,
    rootId: number
  ): AgentGroupThreadDetail {
    requireGroup(orgId, userId, groupId);
    requireSession(orgId, userId, groupId, sessionId);
    const root = requireThreadRoot(orgId, sessionId, rootId);
    const run = this.threadRuns.get(threadKey(sessionId, rootId));

    return {
      messages: [
        root,
        ...listAgentGroupThreadMessages(orgId, sessionId, rootId),
      ],
      profileId: root.authorProfileId ?? "",
      rootId,
      run: run
        ? {
            activity: run.activity,
            speakerProfileId: run.speakerProfileId,
            stopping: run.stopping,
          }
        : null,
    };
  }

  /**
   * Saves the user's message in the thread and has the thread's agent answer
   * it in the background. A message sent while the agent replies is answered
   * in the same run, once.
   */
  postThread(
    orgId: string,
    userId: string,
    groupId: string,
    sessionId: string,
    rootId: number,
    content: string,
    posted: PostedDocument[] = []
  ): Promise<void> {
    const session = requireSession(orgId, userId, groupId, sessionId);
    const root = requireThreadRoot(orgId, sessionId, rootId);
    const key = threadKey(sessionId, rootId);
    const active = this.threadRuns.get(key);
    const documents = workspaceOfGroup(orgId, groupId).saveImages(posted);

    appendAgentGroupMessage(orgId, session, null, content, rootId, documents);

    if (active) {
      active.again = true;
      active.stopping = false;

      return Promise.resolve();
    }

    const run: ThreadRun = {
      activity: null,
      again: true,
      hop: null,
      speakerProfileId: root.authorProfileId,
      stopping: false,
    };

    this.threadRuns.set(key, run);

    return this.replyInThread(orgId, userId, session, root, run).finally(() => {
      if (this.threadRuns.get(key) === run) {
        this.threadRuns.delete(key);
      }
    });
  }

  stopThread(
    orgId: string,
    userId: string,
    groupId: string,
    sessionId: string,
    rootId: number
  ): void {
    requireSession(orgId, userId, groupId, sessionId);

    const run = this.threadRuns.get(threadKey(sessionId, rootId));

    if (run) {
      run.stopping = true;
      run.again = false;
      run.hop?.abort();
    }
  }

  /**
   * Opens a session with its first message and starts the reply run. The
   * session is returned at once; the run comes back as `run` for the caller.
   */
  start(
    orgId: string,
    userId: string,
    groupId: string,
    content: string,
    documents: PostedDocument[] = []
  ) {
    requireGroup(orgId, userId, groupId);

    const session = createGroupSession(
      orgId,
      groupId,
      groupSessionTitle(
        content ||
          (documents.find((d) => !("image" in d || d.path))?.filename ?? "")
      )
    );

    const run = this.post(
      orgId,
      userId,
      groupId,
      session.id,
      content,
      documents
    );

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
    const images = listGroupSessionImages(orgId, sessionId);

    if (!deleteGroupSession(orgId, userId, groupId, sessionId)) {
      throw new NakamaApiError("Session not found", 404);
    }

    this.stopRun(sessionId);
    workspaceOfGroup(orgId, groupId).removeImages(images);
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
    content: string,
    posted: PostedDocument[] = []
  ): Promise<void> {
    const session = requireSession(orgId, userId, groupId, sessionId);
    const active = this.runs.get(sessionId);
    const documents = workspaceOfGroup(orgId, groupId).saveImages(posted);

    if (active) {
      appendAgentGroupMessage(
        orgId,
        session,
        null,
        content,
        undefined,
        documents
      );
      active.inbox.push(content);
      // A new message outranks an earlier Stop.
      active.stopping = false;

      return Promise.resolve();
    }

    const run: ActiveRun = {
      activity: null,
      groupId,
      hop: null,
      hopsLeft: 0,
      inbox: [content],
      lastSpeaker:
        listAgentGroupMessages(orgId, sessionId, undefined, false).findLast(
          (message) =>
            message.authorProfileId !== null && message.content !== ""
        )?.authorProfileId ?? null,
      queue: [],
      speakerProfileId: null,
      steps: [],
      stopping: false,
      text: "",
      titling: null,
    };

    this.runs.set(sessionId, run);

    try {
      appendAgentGroupMessage(
        orgId,
        session,
        null,
        content,
        undefined,
        documents
      );
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
      const roster = this.roster(orgId, group, access);

      for (const message of run.inbox.splice(0)) {
        const woken = addressedMembers(message, roster, run.lastSpeaker);

        // Everyone woken gets a turn, even past the cap (`@all`).
        run.hopsLeft = Math.max(MAX_GROUP_HOPS, woken.length);
        enqueue(run.queue, woken);
      }

      // The session list polls only while a run is active, so the title has
      // to land before the run ends.
      if (
        run.titling &&
        (!group || run.stopping || run.queue.length === 0 || run.hopsLeft <= 0)
      ) {
        await run.titling;
        run.titling = null;
        continue;
      }

      const profileId = run.queue.shift();

      // Decided and cleared in one synchronous step, so a post() can never
      // land in a run that has already finished.
      if (!group || run.stopping || !profileId || run.hopsLeft <= 0) {
        this.runs.delete(session.id);

        return;
      }

      run.speakerProfileId = profileId;
      run.activity = null;
      run.steps = [];
      run.text = "";
      run.hop = new AbortController();

      const outcome = await takeGroupTurn(this.agent, {
        group,
        onActivity: (label) => {
          run.activity = label;
          run.steps.push(label);
        },
        onText: (chunk) => {
          run.text += chunk;
        },
        orgId,
        orgRole: access.orgRole,
        profileId,
        roster,
        session,
        signal: run.hop.signal,
        userId,
      });

      if (outcome.kind === "silent") {
        continue;
      }

      run.hopsLeft -= 1;
      run.lastSpeaker = profileId;

      if (outcome.kind === "replied") {
        run.titling ??= retitleGroupSession(
          this.agent,
          orgId,
          userId,
          session,
          profileId,
          outcome.text
        );
        enqueue(run.queue, roster.mentions(outcome.text, profileId));
      }
    }
  }

  private async replyInThread(
    orgId: string,
    userId: string,
    session: StoredGroupSession,
    root: AgentGroupMessage,
    run: ThreadRun
  ): Promise<void> {
    const profileId = root.authorProfileId;

    while (run.again && !run.stopping && profileId) {
      run.again = false;

      const group = getAgentGroup(orgId, userId, session.groupId);
      const access = await this.access(orgId, userId);

      // Stop may land while access loads, before there is a hop to abort.
      if (run.stopping) {
        return;
      }

      run.hop = new AbortController();

      const outcome = await takeGroupTurn(this.agent, {
        group,
        onActivity: (label) => {
          run.activity = label;
        },
        orgId,
        orgRole: access.orgRole,
        profileId,
        root,
        roster: this.roster(orgId, group, access),
        session,
        signal: run.hop.signal,
        userId,
      });

      run.activity = null;

      if (outcome.kind === "silent") {
        return;
      }
    }
  }

  /** Checks the new members and returns the handles to save for them. */
  private async assertMembers(
    orgId: string,
    userId: string,
    memberIds: string[],
    kept: Partial<Pick<AgentGroup, "handles" | "memberIds">>
  ): Promise<Record<string, string>> {
    if (new Set(memberIds).size !== memberIds.length) {
      throw new NakamaApiError("Each agent can join a group once.", 400);
    }

    const { profiles } = await this.access(orgId, userId);

    const allowed = memberIds.every(
      (id) => kept.memberIds?.includes(id) || profiles.some((p) => p.id === id)
    );

    if (!allowed) {
      throw new NakamaApiError("You cannot use one of these agents.", 403);
    }

    return assignHandles(kept.handles ?? {}, memberIds, profiles);
  }

  /**
   * The group's roster for a turn. A group saved before handles were kept
   * saves them here, before any agent reads a mention.
   */
  private roster(
    orgId: string,
    group: AgentGroup | null,
    access: GroupAccess
  ): GroupRoster {
    if (!group) {
      return groupRoster({ handles: {}, memberIds: [] }, []);
    }

    const handles = assignHandles(
      group.handles,
      group.memberIds,
      access.profiles
    );

    if (Object.keys(handles).length > Object.keys(group.handles).length) {
      addAgentGroupHandles(orgId, group.id, handles);
    }

    return groupRoster({ ...group, handles }, access.profiles);
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
  run.hop?.abort();
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

function threadKey(sessionId: string, rootId: number): string {
  return `${sessionId}:${rootId}`;
}
