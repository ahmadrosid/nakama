import { readTextOrNull, writePrivateTextFile } from "@nakama/core/fs";
import { getWhatsAppConfigDir } from "@nakama/core/whatsapp-config";
import { join } from "node:path";
import { homedir } from "node:os";

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

  get(jid: string): ChatSessionRecord | undefined {
    return this.map[jid];
  }

  set(jid: string, record: ChatSessionRecord): void {
    this.map[jid] = record;
  }

  delete(jid: string): void {
    delete this.map[jid];
  }

  async save(): Promise<void> {
    await writePrivateTextFile(this.path, `${JSON.stringify(this.map, null, 2)}\n`, {
      ensureDir: getWhatsAppConfigDir(),
    });
  }
}

function getChatSessionsPath(): string {
  return join(getWhatsAppConfigDir(), "chat-sessions.json");
}