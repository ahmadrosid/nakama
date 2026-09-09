import type { TelegramWorkerStatus } from "./contract";
import {
  getTelegramConfigDir,
  loadTelegramSettingsPublic,
  resolveTelegramScopeForOrg,
  type TelegramConfigScope,
  type TelegramSettingsPublic,
} from "./telegram-config";
import {
  createWorkerHeartbeatStore,
  isHeartbeatAlive,
  isProcessAlive,
} from "./worker-heartbeat";

export type { WorkerHeartbeatBase as TelegramWorkerHeartbeat } from "./worker-heartbeat";
export { isHeartbeatAlive, isProcessAlive };

/** One heartbeat per identity: the file lives beside the config it belongs to. */
export function createTelegramWorkerHeartbeat(orgId: TelegramConfigScope) {
  return createWorkerHeartbeatStore({
    getDir: () => getTelegramConfigDir(orgId),
  });
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

export async function getTelegramWorkerStatus(
  orgId: string | null
): Promise<TelegramWorkerStatus> {
  const scope = orgId === null ? null : await resolveTelegramScopeForOrg(orgId);
  const settings = await loadTelegramSettingsPublic(scope);
  const running = await createTelegramWorkerHeartbeat(scope).isRunning();

  return resolveTelegramWorkerStatus(settings, running);
}
