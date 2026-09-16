import type { AgentChatSession } from "@nakama/agent";
import type { StoredSessionRecord } from "@nakama/db";

/**
 * A cognito session. It never reaches SQLite, so this map is the only place it
 * exists: drop the entry and the conversation is gone.
 */
export interface EphemeralSession {
  /**
   * Attachments saved during this session. They carry a null session_id, so
   * listAttachmentsForSession cannot find them and the ids have to be kept
   * here to purge the rows and their files when the session ends.
   */
  attachmentIds: Set<string>;
  lastActiveAt: number;
  /** Synthetic; shaped like a row so session paths can treat it as one. */
  record: StoredSessionRecord;
  session: AgentChatSession;
}

/** A tab closed without toggling cognito off leaves an entry behind. */
const IDLE_EVICTION_MS = 12 * 60 * 60 * 1000;

export class EphemeralSessionStore {
  private readonly entries = new Map<string, EphemeralSession>();

  /** Runs on delete and on idle eviction, to purge what the session left. */
  constructor(
    private readonly onEvict: (entry: EphemeralSession) => Promise<void>
  ) {}

  async set(entry: EphemeralSession): Promise<void> {
    // ponytail: eviction rides on the next cognito session rather than a timer.
    // An abandoned entry therefore survives until someone opens another cognito
    // chat, or until a restart, whose attachment sweep collects what it left.
    // Add a timer if idle sessions ever need collecting sooner than that.
    await this.evictIdle();
    this.entries.set(entry.record.id, entry);
  }

  get(sessionId: string): EphemeralSession | undefined {
    const entry = this.entries.get(sessionId);

    if (entry) {
      entry.lastActiveAt = Date.now();
    }

    return entry;
  }

  has(sessionId: string): boolean {
    return this.entries.has(sessionId);
  }

  trackAttachment(sessionId: string, attachmentId: string): void {
    this.entries.get(sessionId)?.attachmentIds.add(attachmentId);
  }

  async delete(sessionId: string): Promise<boolean> {
    const entry = this.entries.get(sessionId);

    if (!entry) {
      return false;
    }

    this.entries.delete(sessionId);
    await this.onEvict(entry);
    return true;
  }

  /** `now` is injectable so the 12-hour threshold can be tested in one tick. */
  async evictIdle(now = Date.now()): Promise<void> {
    for (const [sessionId, entry] of [...this.entries]) {
      if (now - entry.lastActiveAt >= IDLE_EVICTION_MS) {
        await this.delete(sessionId);
      }
    }
  }
}
