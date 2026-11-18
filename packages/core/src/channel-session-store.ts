import { dirname } from "node:path";
import { z } from "zod";
import type { DeliverableChannelArtifact } from "./channel-artifact-delivery";
import { createChatLock } from "./channel-chat-lock";
import type { AgentQuestionnaire } from "./contract";
import { readTextOrNull, writeTextFile } from "./fs";

/** Agent questions shown with buttons, waiting for taps. */
export interface ChannelOpenQuestions {
  /** Choice label by question index. */
  answers: Record<string, string>;
  createdAt: string;
  /** Telegram message id of each question, by question index. */
  messageIds?: number[];
  questionnaire: AgentQuestionnaire;
  /** Short id in the button data, so a tap on older buttons is refused. */
  token: string;
}

export interface ChatSessionRecord {
  artifactShareUrls?: Record<string, string>;
  deliverableArtifacts?: DeliverableChannelArtifact[];
  openQuestions?: ChannelOpenQuestions;
  profileId: string;
  sessionId: string;
  /** Sessions this chat has been bound to. The API lists every session on the channel, so pickers filter to these. */
  sessionIds?: string[];
  updatedAt: string;
}

type ChatSessionMap = Record<string, ChatSessionRecord>;

const OpenQuestionsSchema = z.object({
  answers: z.record(z.string(), z.string()),
  createdAt: z.string(),
  messageIds: z.array(z.number()).optional(),
  questionnaire: z.object({
    id: z.string(),
    questions: z.array(
      z.object({
        allowCustomAnswer: z.boolean(),
        choices: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            recommended: z.boolean().optional(),
          })
        ),
        id: z.string(),
        placeholder: z.string().optional(),
        prompt: z.string(),
      })
    ),
    title: z.string(),
  }),
  token: z.string(),
});

const ChatSessionRecordSchema = z.object({
  artifactShareUrls: z.record(z.string(), z.string()).optional(),
  deliverableArtifacts: z
    .array(
      z.object({
        filename: z.string(),
        mimeType: z.string(),
        path: z.string(),
        savedAt: z.string(),
        sharePath: z.string().nullable(),
        shareUrl: z.string().nullable(),
        sizeBytes: z.number(),
      })
    )
    .optional(),
  // A bad saved question drops only that question, not the chat's session.
  openQuestions: OpenQuestionsSchema.optional().catch(undefined),
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

  /**
   * Keeps the `keep` newest records whose key starts with `prefix`, by
   * updatedAt, and drops the rest. The caller saves.
   */
  dropOldest(prefix: string, keep: number): void {
    const matching = Object.entries(this.map).filter(([chatId]) =>
      chatId.startsWith(prefix)
    );

    if (matching.length <= keep) {
      return;
    }

    // ISO timestamps sort as plain strings; localeCompare would collate them.
    matching.sort(
      ([, a], [, b]) =>
        Number(a.updatedAt > b.updatedAt) - Number(a.updatedAt < b.updatedAt)
    );

    for (const [chatId] of matching.slice(0, matching.length - keep)) {
      this.delete(chatId);
    }
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

  getOpenQuestions(chatId: string): ChannelOpenQuestions | undefined {
    return this.get(chatId)?.openQuestions;
  }

  /** Pass undefined to close the chat's open questions. The caller saves. */
  setOpenQuestions(
    chatId: string,
    openQuestions: ChannelOpenQuestions | undefined
  ): void {
    const existing = this.get(chatId);

    if (!existing) {
      return;
    }

    this.set(chatId, { ...existing, openQuestions });
  }

  async save(): Promise<void> {
    await saveLock.withLock(this.path, () =>
      writeTextFile(this.path, `${JSON.stringify(this.map, null, 2)}\n`, {
        ensureDir: dirname(this.path),
      })
    );
  }
}
