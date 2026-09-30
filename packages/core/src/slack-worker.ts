import {
  type ChannelConfigScope,
  type ChannelOwner,
  isChannelOwner,
} from "./channel-config-shared";
import type { SlackWorkerStatus } from "./contract";
import { getSlackConfigDir, loadSlackSettingsPublic } from "./slack-config";
import {
  createWorkerHeartbeatStore,
  isHeartbeatAlive,
  type WorkerHeartbeatBase,
} from "./worker-heartbeat";

interface SlackWorkerHeartbeat extends WorkerHeartbeatBase {
  connected?: boolean;
}

export { isHeartbeatAlive };

/** One heartbeat per connection: the file lives beside the config it belongs to. */
export function createSlackWorkerHeartbeat(owner: ChannelOwner) {
  const store = createWorkerHeartbeatStore<SlackWorkerHeartbeat>({
    getDir: () => getSlackConfigDir(owner),
    parse: (value, base) => ({
      connected: value.connected === true,
      ...base,
    }),
  });

  return {
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

export async function getSlackWorkerStatus(
  scope: ChannelConfigScope
): Promise<SlackWorkerStatus> {
  if (!isChannelOwner(scope)) {
    return {
      configured: false,
      connected: false,
      ok: true,
      paired: false,
      running: false,
    };
  }

  const settings = await loadSlackSettingsPublic(scope);
  const heartbeat = await createSlackWorkerHeartbeat(scope).read();
  const running = isHeartbeatAlive(heartbeat);

  return {
    configured: settings.configured,
    connected: running && heartbeat?.connected === true,
    ok: !settings.configured || running,
    // Anyone who can chat counts, so the connection stops asking for pairing.
    paired:
      settings.allowWorkspace ||
      settings.pairedUserIds.length > 0 ||
      settings.allowedUserIds.length > 0,
    running,
  };
}
