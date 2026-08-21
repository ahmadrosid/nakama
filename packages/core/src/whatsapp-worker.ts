import { join } from "node:path";
import type { WhatsAppWorkerStatus } from "./contract";
import { pathExists, readTextOrNull, removeFile, writeTextFile } from "./fs";
import {
  getWhatsAppConfigDir,
  loadWhatsAppSettingsPublic,
  type WhatsAppSettingsPublic,
} from "./whatsapp-config";
import {
  createWorkerHeartbeatStore,
  isProcessAlive,
  type WorkerHeartbeatBase,
} from "./worker-heartbeat";

export interface WhatsAppWorkerHeartbeat extends WorkerHeartbeatBase {
  connected?: boolean;
}

const QR_CODE_FILENAME = "worker-qr.txt";

const store = createWorkerHeartbeatStore<WhatsAppWorkerHeartbeat>({
  getDir: getWhatsAppConfigDir,
  parse: (value) => value as unknown as WhatsAppWorkerHeartbeat,
});

export const getWhatsAppWorkerHeartbeatPath = store.getPath;
export const parseWhatsAppWorkerHeartbeat = store.parse;
export const readWhatsAppWorkerHeartbeat = store.read;
export const clearWhatsAppWorkerHeartbeat = store.clear;
export const isWhatsAppWorkerRunning = store.isRunning;
export const isWhatsAppProcessAlive = isProcessAlive;
export const isWhatsAppHeartbeatAlive = store.isAlive;

export function getWhatsAppQrCodePath(): string {
  return join(getWhatsAppConfigDir(), QR_CODE_FILENAME);
}

export function resolveWhatsAppWorkerStatus(
  settings: WhatsAppSettingsPublic,
  running: boolean,
  qrCode: string | null,
  connected = false
): WhatsAppWorkerStatus {
  const configured = settings.configured;
  const paired = settings.pairedJid !== null;
  const ok = !configured || running;

  return { configured, connected, ok, paired, qrCode, running };
}

export async function writeWhatsAppWorkerHeartbeat(
  pid = process.pid,
  updatedAt = new Date().toISOString(),
  connected = false
): Promise<void> {
  await store.write({ connected, pid, updatedAt });
}

export async function writeWhatsAppQrCode(qr: string): Promise<void> {
  await writeTextFile(getWhatsAppQrCodePath(), qr, {
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

export async function getWhatsAppWorkerStatus(): Promise<WhatsAppWorkerStatus> {
  const settings = await loadWhatsAppSettingsPublic();
  const heartbeat = await readWhatsAppWorkerHeartbeat();
  const running = isWhatsAppHeartbeatAlive(heartbeat);
  const qrCode = await readWhatsAppQrCode();
  const connected = heartbeat?.connected === true;

  return resolveWhatsAppWorkerStatus(settings, running, qrCode, connected);
}
