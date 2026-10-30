import {
  type ChannelConfigScope,
  type ChannelOwner,
  isChannelOwner,
} from "./channel-config-shared";
import type { TeamsWorkerStatus } from "./contract";
import { getTeamsConfigDir, loadTeamsConfigFile } from "./teams-config";
import {
  createWorkerHeartbeatStore,
  isHeartbeatAlive,
  type WorkerHeartbeatBase,
} from "./worker-heartbeat";

interface TeamsWorkerHeartbeat extends WorkerHeartbeatBase {
  connected?: boolean;
}

export function createTeamsWorkerHeartbeat(owner: ChannelOwner) {
  const store = createWorkerHeartbeatStore<TeamsWorkerHeartbeat>({
    getDir: () => getTeamsConfigDir(owner),
    parse: (value, base) => ({ ...base, connected: value.connected === true }),
  });

  return {
    acquire: store.acquire,
    clear: store.clear,
    read: store.read,
    write: (connected: boolean) =>
      store.write({
        connected,
        pid: process.pid,
        updatedAt: new Date().toISOString(),
      }),
  };
}

export async function getTeamsWorkerStatus(
  scope: ChannelConfigScope
): Promise<TeamsWorkerStatus> {
  if (!isChannelOwner(scope)) {
    return {
      configured: false,
      connected: false,
      ok: true,
      paired: false,
      running: false,
    };
  }

  const config = await loadTeamsConfigFile(scope);
  const heartbeat = await createTeamsWorkerHeartbeat(scope).read();
  const running = isHeartbeatAlive(heartbeat);

  return {
    configured: config !== null,
    connected:
      running && heartbeat?.connected === true && Boolean(config?.inboundPort),
    ok: config === null || running,
    paired: Boolean(config?.allowedUserIds.length),
    running,
  };
}
