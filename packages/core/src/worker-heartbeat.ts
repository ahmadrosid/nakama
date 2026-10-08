import { Database } from "bun:sqlite";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { JsonValue } from "./contract";
import {
  ensureDir,
  pathExists,
  readTextOrNull,
  removeFile,
  writeTextFile,
} from "./fs";

const DEFAULT_WORKER_HEARTBEAT_MAX_AGE_MS = 45_000;

const HEARTBEAT_FILENAME = "worker-heartbeat.json";

const WorkerHeartbeatSchema = z
  .object({
    pid: z.number().int(),
    updatedAt: z.string(),
  })
  .catchall(z.json());

export type WorkerHeartbeatBase = {
  pid: number;
  updatedAt: string;
};

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

export function isHeartbeatAlive(
  heartbeat: WorkerHeartbeatBase | null,
  maxAgeMs = DEFAULT_WORKER_HEARTBEAT_MAX_AGE_MS
): boolean {
  if (!heartbeat) {
    return false;
  }

  const updatedAt = Date.parse(heartbeat.updatedAt);

  if (!Number.isFinite(updatedAt)) {
    return false;
  }

  if (Date.now() - updatedAt > maxAgeMs) {
    return false;
  }

  return isProcessAlive(heartbeat.pid);
}

export function createWorkerHeartbeatStore<
  T extends WorkerHeartbeatBase,
>(options: {
  getDir: () => string;
  /** Shape/validate after base pid + updatedAt pass. Return null to reject. */
  parse?: (
    value: Record<string, JsonValue>,
    base: WorkerHeartbeatBase
  ) => T | null;
  /** Extra alive check (e.g. automation `running`). */
  isAliveExtra?: (heartbeat: T) => boolean;
}) {
  const getPath = (): string => join(options.getDir(), HEARTBEAT_FILENAME);
  let lease: Database | null = null;
  let usesLease = false;

  // SQLite's OS file lock is released on process death, including SIGKILL.
  const acquire = async (): Promise<void> => {
    usesLease = true;

    if (lease) {
      throw new Error("Worker already owns this connection");
    }

    await ensureDir(options.getDir());
    const path = join(options.getDir(), "worker-lock.sqlite");
    const candidate = new Database(path, { create: true });

    try {
      await chmod(path, 0o600);
      candidate.exec("BEGIN EXCLUSIVE");
      lease = candidate;
    } catch {
      candidate.close();
      throw new Error("This connection already has a running worker");
    }
  };

  const parse = (raw: string): T | null => {
    try {
      const parsed = WorkerHeartbeatSchema.safeParse(JSON.parse(raw));

      if (!parsed.success) {
        return null;
      }

      if (!options.parse) {
        // SAFETY: Without a custom parser, T is the base heartbeat type at call sites.
        return parsed.data as T;
      }

      return options.parse(parsed.data, parsed.data);
    } catch {
      return null;
    }
  };

  const write = async (payload: T): Promise<void> => {
    if (usesLease && !lease) {
      return;
    }

    await writeTextFile(getPath(), `${JSON.stringify(payload)}\n`, {
      ensureDir: options.getDir(),
    });
  };

  const clear = async (): Promise<void> => {
    if (usesLease && !lease) {
      return;
    }

    const path = getPath();

    try {
      const existing = await readTextOrNull(path);

      if (
        existing &&
        parse(existing)?.pid === process.pid &&
        (await pathExists(path))
      ) {
        await removeFile(path);
      }
    } finally {
      lease?.close();
      lease = null;
    }
  };

  const read = async (): Promise<T | null> => {
    const raw = await readTextOrNull(getPath());

    if (raw === null) {
      return null;
    }

    return parse(raw.trim());
  };

  const isAlive = (
    heartbeat: T | null,
    maxAgeMs = DEFAULT_WORKER_HEARTBEAT_MAX_AGE_MS
  ): boolean => {
    if (!(heartbeat && isHeartbeatAlive(heartbeat, maxAgeMs))) {
      return false;
    }

    return options.isAliveExtra ? options.isAliveExtra(heartbeat) : true;
  };

  const isRunning = async (
    maxAgeMs = DEFAULT_WORKER_HEARTBEAT_MAX_AGE_MS
  ): Promise<boolean> => isAlive(await read(), maxAgeMs);

  return { acquire, clear, getPath, isAlive, isRunning, parse, read, write };
}
