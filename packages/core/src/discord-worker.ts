import type { DiscordWorkerStatus } from "./contract";
import {
  type DiscordSettingsPublic,
  getDiscordConfigDir,
  loadDiscordSettingsPublic,
} from "./discord-config";
import {
  createWorkerHeartbeatStore,
  isHeartbeatAlive,
  isProcessAlive,
  type WorkerHeartbeatBase,
} from "./worker-heartbeat";

export interface DiscordWorkerHeartbeat extends WorkerHeartbeatBase {
  connected?: boolean;
}

export { isHeartbeatAlive, isProcessAlive };

const store = createWorkerHeartbeatStore<DiscordWorkerHeartbeat>({
  getDir: getDiscordConfigDir,
  parse: (value, base) => ({
    connected: value.connected === true,
    ...base,
  }),
});

export const getDiscordWorkerHeartbeatPath = store.getPath;
export const parseDiscordWorkerHeartbeat = store.parse;
export const readDiscordWorkerHeartbeat = store.read;
export const clearDiscordWorkerHeartbeat = store.clear;
export const isDiscordWorkerRunning = store.isRunning;

export function resolveDiscordWorkerStatus(
  settings: DiscordSettingsPublic,
  running: boolean,
  connected = false
): DiscordWorkerStatus {
  const configured = settings.configured;
  const paired = settings.pairedUserIds.length > 0;
  const ok = !configured || running;

  return { configured, connected, ok, paired, running };
}

export async function writeDiscordWorkerHeartbeat(
  pid = process.pid,
  updatedAt = new Date().toISOString(),
  connected?: boolean
): Promise<void> {
  await store.write({
    pid,
    updatedAt,
    ...(connected === undefined ? {} : { connected }),
  });
}

export async function getDiscordWorkerStatus(): Promise<DiscordWorkerStatus> {
  const settings = await loadDiscordSettingsPublic();
  const heartbeat = await readDiscordWorkerHeartbeat();
  const running = isHeartbeatAlive(heartbeat);

  return resolveDiscordWorkerStatus(
    settings,
    running,
    heartbeat?.connected === true
  );
}
