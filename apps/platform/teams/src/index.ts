import { join } from "node:path";
import { NakamaClient } from "@nakama/client";
import {
  installErrorHandlers,
  installErrorTrackingSink,
  log,
} from "@nakama/core";
import {
  ChannelConfigBusyError,
  channelOwnerFromEnv,
} from "@nakama/core/channel-config-shared";
import { ChannelSessionStore } from "@nakama/core/channel-session-store";
import {
  ensureServerRunning,
  stopSpawnedServer,
} from "@nakama/core/ensure-server";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { resolveWebPublicUrl } from "@nakama/core/runtime";
import {
  getTeamsConfigDir,
  loadTeamsConfigFile,
  saveTeamsInboundPort,
  validateTeamsCredentials,
} from "@nakama/core/teams-config";
import { createTeamsWorkerHeartbeat } from "@nakama/core/teams-worker";
import { createTeamsChatHandler } from "./chat-handler";
import { startTeamsApp, type TeamsAppHandle } from "./teams-app";

installErrorHandlers("worker:teams");

void installErrorTrackingSink();

const owner = channelOwnerFromEnv();

const heartbeat = createTeamsWorkerHeartbeat(owner);

let spawnedChild: Bun.Subprocess | null = null;

let app: TeamsAppHandle | null = null;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Set once no other live worker holds this connection. Only then is the saved
 * port this process's to clear.
 */
let ownsConnection = false;

async function shutdown(code: number): Promise<never> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }

  await app?.stop();

  // The server forwards only to a port with a live heartbeat, so clearing both
  // means nothing reaches this worker once it is gone. A process refused by
  // the check below leaves alone the port a running worker saved.
  if (ownsConnection) {
    await saveTeamsInboundPort(null, owner).catch(() => {});
  }

  await heartbeat.clear();
  stopSpawnedServer(spawnedChild);

  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => void shutdown(0));
}

// pm2 stops Windows workers with a "shutdown" message instead of a signal.
if (process.platform === "win32") {
  process.on("message", (message) => {
    if (message === "shutdown") {
      void shutdown(0);
    }
  });
}

try {
  await heartbeat.acquire();

  ownsConnection = true;

  const config = await loadTeamsConfigFile(owner);

  if (!config) {
    throw new Error(
      "Configure this agent's Teams connection before starting its worker."
    );
  }

  // Checked again here so an expired secret cannot open a listener that looks
  // like a working connection.
  await validateTeamsCredentials(config);

  const { serverUrl, spawnedChild: child } = await ensureServerRunning();
  spawnedChild = child;

  const client = new NakamaClient({
    authToken: (await loadLocalAuthToken()) ?? undefined,
    baseUrl: serverUrl,
    clientOrigin: resolveWebPublicUrl(),
  });

  await client.listUserOrgs();

  const sessionStore = new ChannelSessionStore(
    join(getTeamsConfigDir(owner), "chat-sessions.json")
  );

  await sessionStore.load();

  const handle = createTeamsChatHandler({
    client,
    loadConfig: () => loadTeamsConfigFile(owner),
    owner,
    send: async (conversationId, text) => {
      await app?.send(conversationId, text);
    },
    sessionStore,
  });

  app = await startTeamsApp({ config, onActivity: handle });

  // A lock left by a crashed worker stays fresh for 15s, but a writer waits
  // only 5s, so keep trying until it goes stale.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await saveTeamsInboundPort(app.port, owner);
      break;
    } catch (error) {
      if (!(error instanceof ChannelConfigBusyError) || attempt >= 4) {
        throw error;
      }
    }
  }

  await heartbeat.write(true);
  heartbeatTimer = setInterval(() => {
    void heartbeat.write(true);
  }, 15_000);

  log("info", "worker.started", { worker: "teams" });
  console.log(`Server: ${serverUrl}`);
  console.log(`Agent: ${owner.profileId}`);
  console.log(`Listening on 127.0.0.1:${app.port}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await shutdown(1);
}
