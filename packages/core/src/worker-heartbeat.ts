import { join } from "node:path";
import { pathExists, readTextOrNull, removeFile, writeTextFile } from "./fs";

const DEFAULT_WORKER_HEARTBEAT_MAX_AGE_MS = 45_000;
const HEARTBEAT_FILENAME = "worker-heartbeat.json";

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
    value: Record<string, unknown>,
    base: WorkerHeartbeatBase
  ) => T | null;
  /** Extra alive check (e.g. automation `running`). */
  isAliveExtra?: (heartbeat: T) => boolean;
}) {
  const getPath = (): string => join(options.getDir(), HEARTBEAT_FILENAME);

  const parse = (raw: string): T | null => {
    try {
      const parsed = JSON.parse(raw) as unknown;

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof (parsed as WorkerHeartbeatBase).pid !== "number" ||
        typeof (parsed as WorkerHeartbeatBase).updatedAt !== "string"
      ) {
        return null;
      }

      const base: WorkerHeartbeatBase = {
        pid: (parsed as WorkerHeartbeatBase).pid,
        updatedAt: (parsed as WorkerHeartbeatBase).updatedAt,
      };

      if (!options.parse) {
        return base as T;
      }

      return options.parse(parsed as Record<string, unknown>, base);
    } catch {
      return null;
    }
  };

  const write = async (payload: T): Promise<void> => {
    await writeTextFile(getPath(), `${JSON.stringify(payload)}\n`, {
      ensureDir: options.getDir(),
    });
  };

  const clear = async (): Promise<void> => {
    const path = getPath();

    if (await pathExists(path)) {
      await removeFile(path);
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
    if (!isHeartbeatAlive(heartbeat, maxAgeMs)) {
      return false;
    }

    return options.isAliveExtra ? options.isAliveExtra(heartbeat as T) : true;
  };

  const isRunning = async (
    maxAgeMs = DEFAULT_WORKER_HEARTBEAT_MAX_AGE_MS
  ): Promise<boolean> => isAlive(await read(), maxAgeMs);

  return { clear, getPath, isAlive, isRunning, parse, read, write };
}
