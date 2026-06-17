import { join } from "node:path";
import type { WhatsAppWorkerStatus } from "./contract";
import {
  getWhatsAppConfigDir,
  loadWhatsAppSettingsPublic,
  type WhatsAppSettingsPublic,
} from "./whatsapp-config";
import { pathExists, readTextOrNull, removeFile, writePrivateTextFile } from "./fs";

export interface WhatsAppWorkerHeartbeat {
  pid: number;
  updatedAt: string;
  connected?: boolean;
}

const DEFAULT_HEARTBEAT_MAX_AGE_MS = 45_000;
const HEARTBEAT_FILENAME = "worker-heartbeat.json";
const QR_CODE_FILENAME = "worker-qr.txt";

export function getWhatsAppWorkerHeartbeatPath(): string {
  return join(getWhatsAppConfigDir(), HEARTBEAT_FILENAME);
}

export function getWhatsAppQrCodePath(): string {
  return join(getWhatsAppConfigDir(), QR_CODE_FILENAME);
}

export function resolveWhatsAppWorkerStatus(
  settings: WhatsAppSettingsPublic,
  running: boolean,
  qrCode: string | null,
  connected = false,
): WhatsAppWorkerStatus {
  const configured = settings.configured;
  const paired = settings.pairedJid !== null;
  const ok = !configured || running;

  return { configured, paired, running, connected, ok, qrCode };
}

export function isWhatsAppProcessAlive(pid: number): boolean {
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

export function isWhatsAppHeartbeatAlive(
  heartbeat: WhatsAppWorkerHeartbeat | null,
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

  return isWhatsAppProcessAlive(heartbeat.pid);
}

export function parseWhatsAppWorkerHeartbeat(
  raw: string,
): WhatsAppWorkerHeartbeat | null {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as WhatsAppWorkerHeartbeat).pid !== "number" ||
      typeof (parsed as WhatsAppWorkerHeartbeat).updatedAt !== "string"
    ) {
      return null;
    }

    return parsed as WhatsAppWorkerHeartbeat;
  } catch {
    return null;
  }
}

export async function writeWhatsAppWorkerHeartbeat(
  pid = process.pid,
  updatedAt = new Date().toISOString(),
  connected = false,
): Promise<void> {
  const payload: WhatsAppWorkerHeartbeat = { pid, updatedAt, connected };

  await writePrivateTextFile(
    getWhatsAppWorkerHeartbeatPath(),
    `${JSON.stringify(payload)}\n`,
    { ensureDir: getWhatsAppConfigDir() },
  );
}

export async function clearWhatsAppWorkerHeartbeat(): Promise<void> {
  const path = getWhatsAppWorkerHeartbeatPath();

  if (await pathExists(path)) {
    await removeFile(path);
  }
}

export async function writeWhatsAppQrCode(qr: string): Promise<void> {
  await writePrivateTextFile(getWhatsAppQrCodePath(), qr, {
    ensureDir: getWhatsAppConfigDir(),
  });
}

export async function clearWhatsAppQrCode(): Promise<void> {
  const path = getWhatsAppQrCodePath();

  if (await pathExists(path)) {
    await removeFile(path);
  }
}

export async function readWhatsAppQrCode(): Promise<string | null> {
  const raw = await readTextOrNull(getWhatsAppQrCodePath());
  return raw?.trim() || null;
}

export async function readWhatsAppWorkerHeartbeat(): Promise<WhatsAppWorkerHeartbeat | null> {
  const raw = await readTextOrNull(getWhatsAppWorkerHeartbeatPath());

  if (raw === null) {
    return null;
  }

  return parseWhatsAppWorkerHeartbeat(raw.trim());
}

export async function isWhatsAppWorkerRunning(
  maxAgeMs = DEFAULT_HEARTBEAT_MAX_AGE_MS,
): Promise<boolean> {
  return isWhatsAppHeartbeatAlive(await readWhatsAppWorkerHeartbeat(), maxAgeMs);
}

export async function getWhatsAppWorkerStatus(): Promise<WhatsAppWorkerStatus> {
  const settings = await loadWhatsAppSettingsPublic();
  const heartbeat = await readWhatsAppWorkerHeartbeat();
  const running = isWhatsAppHeartbeatAlive(heartbeat);
  const qrCode = await readWhatsAppQrCode();
  const connected = heartbeat?.connected === true;

  return resolveWhatsAppWorkerStatus(settings, running, qrCode, connected);
}