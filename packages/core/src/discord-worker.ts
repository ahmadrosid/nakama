import { join } from "node:path";
import type { DiscordWorkerStatus } from "./contract";
import {
  getDiscordConfigDir,
  loadDiscordSettingsPublic,
  type DiscordSettingsPublic,
} from "./discord-config";
import { pathExists, readTextOrNull, removeFile, writePrivateTextFile } from "./fs";

export interface DiscordWorkerHeartbeat {
  pid: number;
  updatedAt: string;
  connected?: boolean;
}

const DEFAULT_HEARTBEAT_MAX_AGE_MS = 45_000;
const HEARTBEAT_FILENAME = "worker-heartbeat.json";

export function getDiscordWorkerHeartbeatPath(): string {
  return join(getDiscordConfigDir(), HEARTBEAT_FILENAME);
}

export function resolveDiscordWorkerStatus(
  settings: DiscordSettingsPublic,
  running: boolean,
  connected = false,
): DiscordWorkerStatus {
  const configured = settings.configured;
  const paired = settings.pairedUserIds.length > 0;
  const ok = !configured || running;

  return { configured, paired, running, connected, ok };
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
  heartbeat: DiscordWorkerHeartbeat | null,
  maxAgeMs = DEFAULT_HEARTBEAT_MAX_AGE_MS,
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

export function parseDiscordWorkerHeartbeat(raw: string): DiscordWorkerHeartbeat | null {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as DiscordWorkerHeartbeat).pid !== "number" ||
      typeof (parsed as DiscordWorkerHeartbeat).updatedAt !== "string"
    ) {
      return null;
    }

    const heartbeat = parsed as DiscordWorkerHeartbeat;

    return {
      pid: heartbeat.pid,
      updatedAt: heartbeat.updatedAt,
      connected: heartbeat.connected === true,
    };
  } catch {
    return null;
  }
}

export async function writeDiscordWorkerHeartbeat(
  pid = process.pid,
  updatedAt = new Date().toISOString(),
  connected?: boolean,
): Promise<void> {
  const payload: DiscordWorkerHeartbeat = {
    pid,
    updatedAt,
    ...(connected === undefined ? {} : { connected }),
  };

  await writePrivateTextFile(
    getDiscordWorkerHeartbeatPath(),
    `${JSON.stringify(payload)}\n`,
    { ensureDir: getDiscordConfigDir() },
  );
}

export async function clearDiscordWorkerHeartbeat(): Promise<void> {
  const path = getDiscordWorkerHeartbeatPath();

  if (await pathExists(path)) {
    await removeFile(path);
  }
}

export async function readDiscordWorkerHeartbeat(): Promise<DiscordWorkerHeartbeat | null> {
  const raw = await readTextOrNull(getDiscordWorkerHeartbeatPath());

  if (raw === null) {
    return null;
  }

  return parseDiscordWorkerHeartbeat(raw.trim());
}

export async function isDiscordWorkerRunning(
  maxAgeMs = DEFAULT_HEARTBEAT_MAX_AGE_MS,
): Promise<boolean> {
  return isHeartbeatAlive(await readDiscordWorkerHeartbeat(), maxAgeMs);
}

export async function getDiscordWorkerStatus(): Promise<DiscordWorkerStatus> {
  const settings = await loadDiscordSettingsPublic();
  const heartbeat = await readDiscordWorkerHeartbeat();
  const running = isHeartbeatAlive(heartbeat);

  return resolveDiscordWorkerStatus(settings, running, heartbeat?.connected === true);
}
