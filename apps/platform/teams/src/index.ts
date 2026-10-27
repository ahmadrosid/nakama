import { join } from "node:path";
import { NakamaClient } from "@nakama/client";
import {
  installErrorHandlers,
  installErrorTrackingSink,
  log,
} from "@nakama/core";
import { hasActiveStreams } from "@nakama/core/channel-active-stream";
import { channelOwnerFromEnv } from "@nakama/core/channel-config-shared";
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
import { isHeartbeatAlive } from "@nakama/core/worker-heartbeat";
import { createTeamsChatHandler } from "./chat-handler";
import { startTeamsApp, type TeamsAppHandle } from "./teams-app";

installErrorHandlers("worker:teams");

void installErrorTrackingSink();

const owner = channelOwnerFromEnv();

const heartbeat = createTeamsWorkerHeartbeat(owner);

let spawnedChild: Bun.Subprocess | null = null;

let app: TeamsAppHandle | null = null;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function shutdown(code: number): Promise<never> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }

  await app?.stop();

  // The server forwards only to a port with a live heartbeat, so clearing both
  // means nothing reaches this worker once it is gone.
  await saveTeamsInboundPort(null, owner).catch(() => {});
  await heartbeat.clear();

  if (hasActiveStreams()) {
    console.warn(
      "Leaving the spawned Nakama server running so in-flight agent turns can finish; the next worker start will reuse it."
    );
  } else {
    stopSpawnedServer(spawnedChild);
  }

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
  const existing = await heartbeat.read();

  if (existing && existing.pid !== process.pid && isHeartbeatAlive(existing)) {
    throw new Error(
      `Another Nakama Teams bridge already runs this connection (pid ${existing.pid}).`
    );
  }

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

  await saveTeamsInboundPort(app.port, owner);
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
