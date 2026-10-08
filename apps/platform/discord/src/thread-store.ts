import { dirname, join } from "node:path";
import { getDiscordConfigDir } from "@nakama/core/discord-config";
import { readTextOrNull, writeTextFile } from "@nakama/core/fs";
import { z } from "zod";

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
      parsed = JSON.parse(raw);
    } catch {
      this.owned = new Set();

      return;
    }

    const next = new Set<string>();

    const arrayResult = z.array(z.unknown()).safeParse(parsed);

    if (arrayResult.success) {
      for (const value of arrayResult.data) {
        const stringResult = z.string().safeParse(value);

        if (stringResult.success && stringResult.data.trim()) {
          next.add(stringResult.data.trim());
        }
      }
    } else {
      const recordResult = z.record(z.string(), z.unknown()).safeParse(parsed);

      if (!recordResult.success) {
        this.owned = next;

        return;
      }

      // Legacy shape: { "threadId": "threadId" } or old key→threadId maps.
      for (const value of Object.values(recordResult.data)) {
        const stringResult = z.string().safeParse(value);

        if (stringResult.success && stringResult.data.trim()) {
          next.add(stringResult.data.trim());
        }
      }
    }

    this.owned = next;
  }

  add(threadId: string): void {
    const id = threadId.trim();

    if (!id) {
      return;
    }

    this.owned.add(id);
  }

  hasThreadId(threadId: string): boolean {
    return this.owned.has(threadId);
  }

  deleteByThreadId(threadId: string): boolean {
    return this.owned.delete(threadId);
  }

  async save(): Promise<void> {
    await writeTextFile(
      this.path,
      `${JSON.stringify([...this.owned], null, 2)}\n`,
      { ensureDir: dirname(this.path) }
    );
  }
}

function getThreadMapPath(): string {
  return join(getDiscordConfigDir(), "chat-threads.json");
}
