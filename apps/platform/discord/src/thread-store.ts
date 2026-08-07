import { readTextOrNull, writePrivateTextFile } from "@nakama/core/fs";
import { getDiscordConfigDir } from "@nakama/core/discord-config";
import { dirname, join } from "node:path";

/** Legacy entries are a single thread id string; multi-thread entries are arrays. */
type ThreadMapValue = string | string[];
type ThreadMap = Record<string, ThreadMapValue>;

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
      const normalized = normalizeThreadIds(value);
      if (normalized.length === 1) {
        next[key] = normalized[0]!;
      } else if (normalized.length > 1) {
        next[key] = normalized;
      }
    }

    this.map = next;
  }

  /** Latest mapped thread for this lookup key, if any. */
  get(lookupKey: string): string | undefined {
    const ids = this.list(lookupKey);
    return ids[ids.length - 1];
  }

  /** All bot-owned threads registered under this lookup key (oldest → newest). */
  list(lookupKey: string): string[] {
    return normalizeThreadIds(this.map[lookupKey]);
  }

  /** True when this thread id was created/tracked by the Discord agent. */
  hasThreadId(threadId: string): boolean {
    for (const stored of Object.values(this.map)) {
      if (normalizeThreadIds(stored).includes(threadId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Register a bot-owned thread. Appends without dropping prior threads so
   * in-thread follow-ups keep working after a newer parent-channel mention.
   */
  add(lookupKey: string, threadId: string): void {
    const existing = this.list(lookupKey).filter((id) => id !== threadId);
    existing.push(threadId);
    this.map[lookupKey] = serializeThreadIds(existing);
  }

  /** Alias for add — kept for call sites that previously replaced the sole mapping. */
  set(lookupKey: string, threadId: string): void {
    this.add(lookupKey, threadId);
  }

  delete(lookupKey: string): void {
    delete this.map[lookupKey];
  }

  /** Drop this Discord thread id from every mapping (other threads stay owned). */
  deleteByThreadId(threadId: string): boolean {
    let removed = false;
    for (const [key, value] of Object.entries(this.map)) {
      const ids = normalizeThreadIds(value);
      const next = ids.filter((id) => id !== threadId);
      if (next.length === ids.length) {
        continue;
      }
      removed = true;
      if (next.length === 0) {
        delete this.map[key];
      } else {
        this.map[key] = serializeThreadIds(next);
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

function normalizeThreadIds(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) {
    return [value];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() && !ids.includes(entry)) {
      ids.push(entry);
    }
  }
  return ids;
}

/** Persist a single id as a string for backwards-compatible chat-threads.json. */
function serializeThreadIds(ids: string[]): ThreadMapValue {
  return ids.length === 1 ? ids[0]! : ids;
}

function getThreadMapPath(): string {
  return join(getDiscordConfigDir(), "chat-threads.json");
}
