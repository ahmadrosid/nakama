import { readTextOrNull, writePrivateTextFile } from "@nakama/core/fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ChatSessionRecord {
  sessionId: string;
  profileId: string;
  updatedAt: string;
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

  async save(): Promise<void> {
    await writePrivateTextFile(this.path, `${JSON.stringify(this.map, null, 2)}\n`, {
      ensureDir: getTelegramConfigDir(),
    });
  }
}

function getTelegramConfigDir(): string {
  return join(homedir(), ".nakama", "telegram");
}

function getChatSessionsPath(): string {
  return join(getTelegramConfigDir(), "chat-sessions.json");
}
