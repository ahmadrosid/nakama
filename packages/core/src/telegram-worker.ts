import type { TelegramWorkerStatus } from "./contract";
import {
  getTelegramConfigDir,
  loadTelegramSettingsPublic,
  type TelegramSettingsPublic,
} from "./telegram-config";
import {
  createWorkerHeartbeatStore,
  isHeartbeatAlive,
  isProcessAlive,
} from "./worker-heartbeat";

export type { WorkerHeartbeatBase as TelegramWorkerHeartbeat } from "./worker-heartbeat";
export { isHeartbeatAlive, isProcessAlive };

const store = createWorkerHeartbeatStore({
  getDir: getTelegramConfigDir,
});

export const getTelegramWorkerHeartbeatPath = store.getPath;
export const parseTelegramWorkerHeartbeat = store.parse;
export const readTelegramWorkerHeartbeat = store.read;
export const clearTelegramWorkerHeartbeat = store.clear;
export const isTelegramWorkerRunning = store.isRunning;

export function resolveTelegramWorkerStatus(
  settings: TelegramSettingsPublic,
  running: boolean
): TelegramWorkerStatus {
  const configured = settings.configured;
  const paired = settings.pairedUserIds.length > 0;
  const ok = !configured || running;

  return { configured, ok, paired, running };
}

export async function writeTelegramWorkerHeartbeat(
  pid = process.pid,
  updatedAt = new Date().toISOString()
): Promise<void> {
  await store.write({ pid, updatedAt });
}

export async function getTelegramWorkerStatus(): Promise<TelegramWorkerStatus> {
  const settings = await loadTelegramSettingsPublic();
  const running = await isTelegramWorkerRunning();

  return resolveTelegramWorkerStatus(settings, running);
}
