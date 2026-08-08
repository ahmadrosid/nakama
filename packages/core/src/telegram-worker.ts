import { join } from "node:path";
import type { TelegramWorkerStatus } from "./contract";
import {
  pathExists,
  readTextOrNull,
  removeFile,
  writePrivateTextFile,
} from "./fs";
import {
  getTelegramConfigDir,
  loadTelegramSettingsPublic,
  type TelegramSettingsPublic,
} from "./telegram-config";

export interface TelegramWorkerHeartbeat {
  pid: number;
  updatedAt: string;
}

const DEFAULT_HEARTBEAT_MAX_AGE_MS = 45_000;
const HEARTBEAT_FILENAME = "worker-heartbeat.json";

export function getTelegramWorkerHeartbeatPath(): string {
  return join(getTelegramConfigDir(), HEARTBEAT_FILENAME);
}

export function resolveTelegramWorkerStatus(
  settings: TelegramSettingsPublic,
  running: boolean
): TelegramWorkerStatus {
  const configured = settings.configured;
  const paired = settings.pairedUserIds.length > 0;
  const ok = !configured || running;

  return { configured, ok, paired, running };
}

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
  heartbeat: TelegramWorkerHeartbeat | null,
  maxAgeMs = DEFAULT_HEARTBEAT_MAX_AGE_MS
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

export function parseTelegramWorkerHeartbeat(
  raw: string
): TelegramWorkerHeartbeat | null {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as TelegramWorkerHeartbeat).pid !== "number" ||
      typeof (parsed as TelegramWorkerHeartbeat).updatedAt !== "string"
    ) {
      return null;
    }

    return parsed as TelegramWorkerHeartbeat;
  } catch {
    return null;
  }
}

export async function writeTelegramWorkerHeartbeat(
  pid = process.pid,
  updatedAt = new Date().toISOString()
): Promise<void> {
  const payload: TelegramWorkerHeartbeat = { pid, updatedAt };

  await writePrivateTextFile(
    getTelegramWorkerHeartbeatPath(),
    `${JSON.stringify(payload)}\n`,
    { ensureDir: getTelegramConfigDir() }
  );
}

export async function clearTelegramWorkerHeartbeat(): Promise<void> {
  const path = getTelegramWorkerHeartbeatPath();

  if (await pathExists(path)) {
    await removeFile(path);
  }
}

export async function readTelegramWorkerHeartbeat(): Promise<TelegramWorkerHeartbeat | null> {
  const raw = await readTextOrNull(getTelegramWorkerHeartbeatPath());

  if (raw === null) {
    return null;
  }

  return parseTelegramWorkerHeartbeat(raw.trim());
}

export async function isTelegramWorkerRunning(
  maxAgeMs = DEFAULT_HEARTBEAT_MAX_AGE_MS
): Promise<boolean> {
  return isHeartbeatAlive(await readTelegramWorkerHeartbeat(), maxAgeMs);
}

export async function getTelegramWorkerStatus(): Promise<TelegramWorkerStatus> {
  const settings = await loadTelegramSettingsPublic();
  const running = await isTelegramWorkerRunning();

  return resolveTelegramWorkerStatus(settings, running);
}
