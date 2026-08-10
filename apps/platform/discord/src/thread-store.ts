import { dirname, join } from "node:path";
import { getDiscordConfigDir } from "@nakama/core/discord-config";
import { readTextOrNull, writePrivateTextFile } from "@nakama/core/fs";

/** Persisted ownership of Discord threads the bot started. */
export class ThreadStore {
  private readonly path: string;
  private owned = new Set<string>();

  constructor(path = getThreadMapPath()) {
    this.path = path;
  }

  async load(): Promise<void> {
    const raw = await readTextOrNull(this.path);

    if (raw === null) {
      this.owned = new Set();
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      this.owned = new Set();
      return;
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      this.owned = new Set();
      return;
    }

    const next = new Set<string>();

    // Legacy shape: { "g:channel:u:user": "threadId" } — keep values as owned ids.
    // Ownership shape: { "threadId": "threadId" } (or any object whose values are thread ids).
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) {
        next.add(value.trim());
      }
    }

    this.owned = next;
  }

  /** Record a Discord thread id created/tracked by this bot. */
  add(threadId: string): void {
    const id = threadId.trim();
    if (!id) {
      return;
    }
    this.owned.add(id);
  }

  /** True when this thread id was created/tracked by the Discord agent. */
  hasThreadId(threadId: string): boolean {
    return this.owned.has(threadId);
  }

  /** Drop ownership for this Discord thread id. */
  deleteByThreadId(threadId: string): boolean {
    return this.owned.delete(threadId);
  }

  async save(): Promise<void> {
    const map: Record<string, string> = {};
    for (const id of this.owned) {
      map[id] = id;
    }
    await writePrivateTextFile(this.path, `${JSON.stringify(map, null, 2)}\n`, {
      ensureDir: dirname(this.path),
    });
  }
}

function getThreadMapPath(): string {
  return join(getDiscordConfigDir(), "chat-threads.json");
}
