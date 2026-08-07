import { readTextOrNull, writePrivateTextFile } from "@nakama/core/fs";
import { getDiscordConfigDir } from "@nakama/core/discord-config";
import { dirname, join } from "node:path";

type ThreadMap = Record<string, string>;

export class ThreadStore {
  private readonly path: string;
  private map: ThreadMap = {};

  constructor(path = getThreadMapPath()) {
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

    const next: ThreadMap = {};

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) {
        next[key] = value;
      }
    }

    this.map = next;
  }

  get(lookupKey: string): string | undefined {
    return this.map[lookupKey];
  }

  /** True when this thread id was created/tracked by the Discord agent. */
  hasThreadId(threadId: string): boolean {
    for (const stored of Object.values(this.map)) {
      if (stored === threadId) {
        return true;
      }
    }
    return false;
  }

  set(lookupKey: string, threadId: string): void {
    this.map[lookupKey] = threadId;
  }

  delete(lookupKey: string): void {
    delete this.map[lookupKey];
  }

  /** Drop every mapping that points at this Discord thread id. */
  deleteByThreadId(threadId: string): boolean {
    let removed = false;
    for (const [key, value] of Object.entries(this.map)) {
      if (value === threadId) {
        delete this.map[key];
        removed = true;
      }
    }
    return removed;
  }

  async save(): Promise<void> {
    await writePrivateTextFile(this.path, `${JSON.stringify(this.map, null, 2)}\n`, {
      ensureDir: dirname(this.path),
    });
  }
}

function getThreadMapPath(): string {
  return join(getDiscordConfigDir(), "chat-threads.json");
}
