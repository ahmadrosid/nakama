import { dirname } from "node:path";
import { z } from "zod";
import type { DeliverableChannelArtifact } from "./channel-artifact-delivery";
import { createChatLock } from "./channel-chat-lock";
import { readTextOrNull, writeTextFile } from "./fs";

export interface ChatSessionRecord {
  artifactShareUrls?: Record<string, string>;
  deliverableArtifacts?: DeliverableChannelArtifact[];
  profileId: string;
  sessionId: string;
  /** Sessions this chat has been bound to. The API lists every session on the channel, so pickers filter to these. */
  sessionIds?: string[];
  updatedAt: string;
}

type ChatSessionMap = Record<string, ChatSessionRecord>;

const ChatSessionRecordSchema = z.object({
  artifactShareUrls: z.record(z.string(), z.string()).optional(),
  deliverableArtifacts: z.array(z.object({
    filename: z.string(),
    mimeType: z.string(),
    path: z.string(),
    savedAt: z.string(),
    sharePath: z.string().nullable(),
    shareUrl: z.string().nullable(),
    sizeBytes: z.number(),
  })).optional(),
  profileId: z.string(),
  sessionId: z.string(),
  sessionIds: z.array(z.string()).optional(),
  updatedAt: z.string(),
});

const ChatSessionMapSchema = z.record(z.string(), ChatSessionRecordSchema);

// Each save rewrites the whole map. Unserialized, an older snapshot can be
// renamed into place after a newer one and undo it on the next restart.
const saveLock = createChatLock();

/** JSON session map for channel bridges (Discord / Telegram / WhatsApp). */
export class ChannelSessionStore {
  private map: ChatSessionMap = {};
  /** In-memory RemoteChatSession wrappers — not persisted. */
  private readonly hotSessions = new Map<string, object>();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    this.hotSessions.clear();
    const raw = await readTextOrNull(this.path);

    if (raw === null) {
      this.map = {};

      return;
    }

    const parsed = ChatSessionMapSchema.safeParse(JSON.parse(raw));
    this.map = parsed.success ? parsed.data : {};
  }

  get(chatId: string): ChatSessionRecord | undefined {
    return this.map[chatId];
  }

  set(chatId: string, record: ChatSessionRecord): void {
    const previous = this.map[chatId];
    this.map[chatId] = record;

    if (previous && previous.sessionId !== record.sessionId) {
      this.hotSessions.delete(chatId);
    }
  }

  delete(chatId: string): void {
    delete this.map[chatId];
    this.hotSessions.delete(chatId);
  }

  getHotSession<T>(chatId: string): T | undefined {
    // SAFETY: The caller uses the same chat key and session type passed to setHotSession.
    return this.hotSessions.get(chatId) as T | undefined;
  }

  setHotSession<T extends object>(chatId: string, session: T): void {
    this.hotSessions.set(chatId, session);
  }

  getArtifactShareUrls(chatId: string) {
    return { ...(this.get(chatId)?.artifactShareUrls ?? {}) };
  }

  getDeliverableArtifacts(chatId: string): DeliverableChannelArtifact[] {
    return [...(this.get(chatId)?.deliverableArtifacts ?? [])];
  }

  updateArtifactState(
    chatId: string,
    update: {
      artifactShareUrls?: Record<string, string>;
      deliverableArtifacts?: DeliverableChannelArtifact[];
    }
  ): void {
    const existing = this.get(chatId);

    if (!existing) {
      return;
    }

    this.set(chatId, {
      ...existing,
      artifactShareUrls: update.artifactShareUrls ?? existing.artifactShareUrls,
      deliverableArtifacts:
        update.deliverableArtifacts ?? existing.deliverableArtifacts,
    });
  }

  async save(): Promise<void> {
    await saveLock.withLock(this.path, () =>
      writeTextFile(this.path, `${JSON.stringify(this.map, null, 2)}\n`, {
        ensureDir: dirname(this.path),
      })
    );
  }
}
