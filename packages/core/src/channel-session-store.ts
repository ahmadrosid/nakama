import { dirname } from "node:path";
import type { DeliverableChannelArtifact } from "./channel-artifact-delivery";
import { readTextOrNull, writeTextFile } from "./fs";

export interface ChatSessionRecord {
  artifactShareUrls?: Record<string, string>;
  deliverableArtifacts?: DeliverableChannelArtifact[];
  profileId: string;
  sessionId: string;
  updatedAt: string;
}

type ChatSessionMap = Record<string, ChatSessionRecord>;

type HotSessionEntry = {
  session: unknown;
  sessionId: string;
};

/** JSON session map for channel bridges (Discord / Telegram / WhatsApp). */
export class ChannelSessionStore {
  private map: ChatSessionMap = {};
  /** In-memory RemoteChatSession wrappers — not persisted. */
  private readonly hotSessions = new Map<string, HotSessionEntry>();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    this.hotSessions.clear();
    const raw = await readTextOrNull(this.path);

    if (raw === null) {
      this.map = {};
      return;
    }

    const parsed = JSON.parse(raw) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      this.map = {};
      return;
    }

    this.map = parsed as ChatSessionMap;
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

  getHotSession<T>(chatId: string, sessionId: string): T | undefined {
    const hot = this.hotSessions.get(chatId);
    if (!hot || hot.sessionId !== sessionId) {
      return;
    }
    return hot.session as T;
  }

  setHotSession(chatId: string, sessionId: string, session: unknown): void {
    this.hotSessions.set(chatId, { session, sessionId });
  }

  getArtifactShareUrls(chatId: string): Record<string, string> {
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
    await writeTextFile(this.path, `${JSON.stringify(this.map, null, 2)}\n`, {
      ensureDir: dirname(this.path),
    });
  }
}
