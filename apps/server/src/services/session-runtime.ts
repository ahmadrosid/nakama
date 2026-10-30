import type { AgentChatSession } from "@nakama/agent";
import type { AgentChannel, ChatMessage, OrgRole } from "@nakama/core";
import { NakamaApiError, parseAgentChannel } from "@nakama/core";
import type { StoredSessionRecord } from "@nakama/db";
import {
  type EphemeralSession,
  EphemeralSessionStore,
} from "./ephemeral-session-store";
import { sessionTurnRegistry } from "./session-turn-registry";

/**
 * Every opened session used to stay in memory with its history until a
 * restart, which is most of a long-lived instance's RAM growth. An evicted
 * session is rebuilt from SQLite on its next turn, as after a restart.
 */
const MAX_CACHED_CHATS = 50;

export type SessionKind = "branch" | "chat" | "child" | "cognito";

/** A branch has a parent too, but it also has the message it branched at. */
export function sessionKind(record: {
  branchMessageIndex?: number | null;
  parentSessionId?: string | null;
}): Exclude<SessionKind, "cognito"> {
  if (!record.parentSessionId) {
    return "chat";
  }

  return (record.branchMessageIndex ?? null) === null ? "child" : "branch";
}

type InheritedFields = Pick<
  StoredSessionRecord,
  | "channel"
  | "codingWorkspaceRoot"
  | "model"
  | "profileId"
  | "thinkingEffort"
  | "userId"
>;

/**
 * What a new session copies from the one it starts from. A branch continues
 * the same chat, so it keeps the run settings; a child chat runs on the
 * profile's own model.
 */
export function inheritFrom(
  parent: StoredSessionRecord,
  kind: "branch" | "child"
): InheritedFields {
  return {
    channel: parent.channel,
    codingWorkspaceRoot: parent.codingWorkspaceRoot ?? null,
    model: kind === "branch" ? parent.model : null,
    profileId: parent.profileId,
    thinkingEffort: kind === "branch" ? (parent.thinkingEffort ?? null) : null,
    userId: parent.userId ?? null,
  };
}

/** What a chat is built with besides its session record. */
export interface ChatBuildContext {
  channel: AgentChannel;
  /** A cognito chat has nothing stored, so a rebuild is seeded with this. */
  initialHistory?: ChatMessage[];
  isPlatformAdmin: boolean;
  kind: SessionKind;
  orgId: string;
  orgRole: OrgRole | null;
}

export interface SessionRuntimeDeps {
  accessFor(
    orgId: string,
    userId: string | null | undefined
  ): Promise<{ isPlatformAdmin: boolean; orgRole: OrgRole | null }>;
  build(
    record: StoredSessionRecord,
    context: ChatBuildContext
  ): Promise<AgentChatSession>;
  isTurnActive?(sessionId: string): boolean;
  /** Null when the session is missing or belongs to another org. */
  loadRecord(
    sessionId: string,
    orgId: string
  ): Promise<StoredSessionRecord | null>;
  /** Runs when a cognito chat ends or goes idle, to purge what it left. */
  onCognitoEnd(entry: EphemeralSession): Promise<void>;
  /** Changes whenever what the profile may use changes. */
  revisionFor(orgId: string, profileId: string): Promise<string>;
}

interface CachedChat {
  chat: AgentChatSession;
  profileId: string;
  revision: string;
}

/**
 * Turns a session id into a chat ready for a turn. It owns both places a chat
 * lives (the stored-chat cache and the cognito store) and decides when a chat
 * is out of date and has to be built again.
 */
export class SessionRuntime {
  private readonly chats = new Map<string, CachedChat>();
  private readonly cognito: EphemeralSessionStore;
  private readonly isTurnActive: (sessionId: string) => boolean;

  constructor(private readonly deps: SessionRuntimeDeps) {
    this.cognito = new EphemeralSessionStore(deps.onCognitoEnd);
    this.isTurnActive =
      deps.isTurnActive ?? ((id) => sessionTurnRegistry.isActive(id));
  }

  /**
   * The chat for a session, built when missing or out of date. While a turn
   * runs it returns the running chat as is; `forNewTurn` checks it anyway.
   */
  async get(
    sessionId: string,
    orgId: string,
    { forNewTurn = false }: { forNewTurn?: boolean } = {}
  ): Promise<AgentChatSession | null> {
    const record = await this.deps.loadRecord(sessionId, orgId);

    if (!record) {
      return null;
    }

    const entry = this.cognito.get(sessionId);
    const cached = this.chats.get(sessionId);

    if (!forNewTurn && this.isTurnActive(sessionId)) {
      const running = entry?.session ?? cached?.chat;

      if (running) {
        return running;
      }
    }

    const revision = await this.deps.revisionFor(orgId, record.profileId);

    if (entry) {
      if ((entry.revision ?? "") !== revision) {
        await this.rebuildCognito(entry, orgId, revision);
      }

      return entry.session;
    }

    if (cached?.revision === revision) {
      this.remember(sessionId, cached);

      return cached.chat;
    }

    const channel = parseAgentChannel(record.channel);

    if (!channel) {
      return null;
    }

    const chat = await this.build(record, orgId, channel, sessionKind(record));

    this.remember(sessionId, { chat, profileId: record.profileId, revision });

    return chat;
  }

  /** The chat held for a session, without building one. */
  peek(sessionId: string): AgentChatSession | undefined {
    return (
      this.cognito.get(sessionId)?.session ?? this.chats.get(sessionId)?.chat
    );
  }

  /** A cognito chat has no row, so it is built now and held until it ends. */
  async openCognito(record: StoredSessionRecord, orgId: string): Promise<void> {
    const channel = parseAgentChannel(record.channel);

    if (!channel) {
      throw new NakamaApiError("Session channel is invalid.", 400);
    }

    const revision = await this.deps.revisionFor(orgId, record.profileId);

    await this.cognito.set({
      attachmentIds: new Set(),
      lastActiveAt: Date.now(),
      record,
      revision,
      session: await this.build(record, orgId, channel, "cognito", []),
    });
  }

  /**
   * A stored chat is dropped and built from its row on the next turn. A
   * cognito chat has no row, so it is rebuilt now with its history.
   */
  async runSettingsChanged(
    sessionId: string,
    orgId: string,
    settings: Partial<Pick<StoredSessionRecord, "model" | "thinkingEffort">>
  ): Promise<void> {
    const entry = this.cognito.get(sessionId);

    if (!entry) {
      this.chats.delete(sessionId);

      return;
    }

    await this.rebuildCognito(
      entry,
      orgId,
      await this.deps.revisionFor(orgId, entry.record.profileId),
      settings
    );
  }

  /** Clears and drops the chat. A cognito chat also loses what it saved. */
  async end(sessionId: string): Promise<void> {
    if (await this.cognito.delete(sessionId)) {
      return;
    }

    this.chats.get(sessionId)?.chat.clear();
    this.chats.delete(sessionId);
  }

  /** Cognito chats survive unless asked: their history lives nowhere else. */
  invalidateAll({ cognito = false }: { cognito?: boolean } = {}): void {
    this.chats.clear();

    if (cognito) {
      this.cognito.clear();
    }
  }

  invalidateProfile(
    profileId: string,
    { clear = false }: { clear?: boolean } = {}
  ): void {
    for (const [sessionId, cached] of this.chats) {
      if (cached.profileId === profileId) {
        if (clear) {
          cached.chat.clear();
        }

        this.chats.delete(sessionId);
      }
    }
  }

  invalidateSession(sessionId: string): void {
    this.chats.delete(sessionId);
  }

  isCognito(sessionId: string): boolean {
    return this.cognito.has(sessionId);
  }

  cognitoRecord(sessionId: string): StoredSessionRecord | undefined {
    return this.cognito.get(sessionId)?.record;
  }

  cognitoByAttachment(attachmentId: string): StoredSessionRecord | undefined {
    return this.cognito.findByAttachmentId(attachmentId)?.record;
  }

  trackAttachment(sessionId: string, attachmentId: string): void {
    this.cognito.trackAttachment(sessionId, attachmentId);
  }

  /** Access comes from the session's owner, so a rebuild matches the first build. */
  private async build(
    record: StoredSessionRecord,
    orgId: string,
    channel: AgentChannel,
    kind: SessionKind,
    initialHistory?: ChatMessage[]
  ): Promise<AgentChatSession> {
    const { isPlatformAdmin, orgRole } = await this.deps.accessFor(
      orgId,
      record.userId
    );

    return this.deps.build(record, {
      channel,
      initialHistory,
      isPlatformAdmin,
      kind,
      orgId,
      orgRole,
    });
  }

  /**
   * A new provider or capability set means a new chat object. The
   * conversation only exists in the old one, so it is carried across by hand.
   */
  private async rebuildCognito(
    entry: EphemeralSession,
    orgId: string,
    revision: string,
    settings: Partial<StoredSessionRecord> = {}
  ): Promise<void> {
    const channel = parseAgentChannel(entry.record.channel);

    if (!channel) {
      throw new NakamaApiError("Session refresh failed. Try again.", 503);
    }

    entry.session = await this.build(
      { ...entry.record, ...settings },
      orgId,
      channel,
      "cognito",
      [...entry.session.getHistory()]
    );
    Object.assign(entry.record, settings);
    entry.revision = revision;
    await this.cognito.set(entry);
  }

  /** Least recently used first out; a chat mid-turn is never evicted. */
  private remember(sessionId: string, cached: CachedChat): void {
    this.chats.delete(sessionId);
    this.chats.set(sessionId, cached);

    for (const id of this.chats.keys()) {
      if (this.chats.size <= MAX_CACHED_CHATS) {
        break;
      }

      if (!this.isTurnActive(id)) {
        this.chats.delete(id);
      }
    }
  }
}
