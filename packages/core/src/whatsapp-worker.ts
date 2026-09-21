import { join } from "node:path";
import type { ChannelConfigScope } from "./channel-config-shared";
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

export function createWhatsAppWorkerHeartbeat(
  orgId: ChannelConfigScope = null
) {
  return createWorkerHeartbeatStore<WhatsAppWorkerHeartbeat>({
    getDir: () => getWhatsAppConfigDir(orgId),
    parse: (value) => value as unknown as WhatsAppWorkerHeartbeat,
  });
}
const store = createWhatsAppWorkerHeartbeat();

export const getWhatsAppWorkerHeartbeatPath = store.getPath;
export const parseWhatsAppWorkerHeartbeat = store.parse;
export const readWhatsAppWorkerHeartbeat = store.read;
export const clearWhatsAppWorkerHeartbeat = store.clear;
export const isWhatsAppWorkerRunning = store.isRunning;
export const isWhatsAppProcessAlive = isProcessAlive;
export const isWhatsAppHeartbeatAlive = store.isAlive;

export function getWhatsAppQrCodePath(
  orgId: ChannelConfigScope = null
): string {
  return join(getWhatsAppConfigDir(orgId), QR_CODE_FILENAME);
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
  connected = false,
  orgId: ChannelConfigScope = null
): Promise<void> {
  await createWhatsAppWorkerHeartbeat(orgId).write({
    connected,
    pid,
    updatedAt,
  });
}

export async function writeWhatsAppQrCode(
  qr: string,
  orgId: ChannelConfigScope = null
): Promise<void> {
  await writeTextFile(getWhatsAppQrCodePath(orgId), qr, {
    ensureDir: getWhatsAppConfigDir(orgId),
  });
}

export async function clearWhatsAppQrCode(
  orgId: ChannelConfigScope = null
): Promise<void> {
  const path = getWhatsAppQrCodePath(orgId);

  if (await pathExists(path)) {
    await removeFile(path);
  }
}

export async function readWhatsAppQrCode(
  orgId: ChannelConfigScope = null
): Promise<string | null> {
  const raw = await readTextOrNull(getWhatsAppQrCodePath(orgId));
  return raw?.trim() || null;
}

export async function getWhatsAppWorkerStatus(
  orgId: ChannelConfigScope = null
): Promise<WhatsAppWorkerStatus> {
  const settings = await loadWhatsAppSettingsPublic(orgId);
  const heartbeat = await createWhatsAppWorkerHeartbeat(orgId).read();
  const running = isWhatsAppHeartbeatAlive(heartbeat);
  const qrCode = await readWhatsAppQrCode(orgId);
  const connected = heartbeat?.connected === true;

  return resolveWhatsAppWorkerStatus(settings, running, qrCode, connected);
}
