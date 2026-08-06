import type { DeliverableChannelArtifact } from "@nakama/core/channel-artifact-delivery";
import { readTextOrNull, writePrivateTextFile } from "@nakama/core/fs";
import { getDiscordConfigDir } from "@nakama/core/discord-config";
import { join } from "node:path";

export interface ChatSessionRecord {
  sessionId: string;
  profileId: string;
  updatedAt: string;
  artifactShareUrls?: Record<string, string>;
  deliverableArtifacts?: DeliverableChannelArtifact[];
}

type ChatSessionMap = Record<string, ChatSessionRecord>;

export class SessionStore {
  private readonly path: string;
  private map: ChatSessionMap = {};

  constructor(path = getChatSessionsPath()) {
    this.path = path;
  }

  async load(): Promise<void> {
    const raw = await readTextOrNull(this.path);

    if (raw === null) {
      this.map = {};
      return;
    }

    const parsed = JSON.parse(raw) as unknown;

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      this.map = {};
      return;
    }

    this.map = parsed as ChatSessionMap;
  }

  get(chatId: string): ChatSessionRecord | undefined {
    return this.map[chatId];
  }

  set(chatId: string, record: ChatSessionRecord): void {
    this.map[chatId] = record;
  }

  delete(chatId: string): void {
    delete this.map[chatId];
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
    },
  ): void {
    const existing = this.get(chatId);
    if (!existing) {
      return;
    }

    this.set(chatId, {
      ...existing,
      artifactShareUrls: update.artifactShareUrls ?? existing.artifactShareUrls,
      deliverableArtifacts: update.deliverableArtifacts ?? existing.deliverableArtifacts,
    });
  }

  async save(): Promise<void> {
    await writePrivateTextFile(this.path, `${JSON.stringify(this.map, null, 2)}\n`, {
      ensureDir: getDiscordConfigDir(),
    });
  }
}

function getChatSessionsPath(): string {
  return join(getDiscordConfigDir(), "chat-sessions.json");
}
