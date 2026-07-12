import { createClient } from "@nakama/client";
import { ChannelOrgStore, getChannelOrgSelectionPath } from "@nakama/core/channel-org";
import { ensureServerRunning, stopSpawnedServer } from "@nakama/core/ensure-server";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { resolveWebPublicUrl } from "@nakama/core/runtime";
import {
  clearDiscordWorkerHeartbeat,
  isHeartbeatAlive,
  readDiscordWorkerHeartbeat,
  writeDiscordWorkerHeartbeat,
} from "@nakama/core/discord-worker";
import { DiscordAuthStore } from "./auth-store";
import { createBot } from "./bot";
import { loadConfig } from "./config";
import { SessionStore } from "./session-store";

let spawnedChild: Bun.Subprocess | null = null;
let clientStop: (() => void) | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

registerCleanupHandlers(() => {
  clientStop?.();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  void clearDiscordWorkerHeartbeat();
  stopSpawnedServer(spawnedChild);
});

try {
  const existingHeartbeat = await readDiscordWorkerHeartbeat();

  if (
    existingHeartbeat &&
    existingHeartbeat.pid !== process.pid &&
    isHeartbeatAlive(existingHeartbeat)
  ) {
    console.error(
      `Another Nakama Discord bridge is already running (pid ${existingHeartbeat.pid}). ` +
        "Stop the existing bridge worker or disable it in the dashboard before starting a new one.",
    );
    process.exit(1);
  }

  const config = await loadConfig();
  const { serverUrl, spawnedChild: child } = await ensureServerRunning();
  spawnedChild = child;

  const client = createClient({
    baseUrl: serverUrl,
    authToken: (await loadLocalAuthToken("discord@nakama.internal")) ?? undefined,
    clientOrigin: resolveWebPublicUrl(),
  });
  const health = await client.health();

  if (!health.providerConfigured) {
    console.warn(
      "Server has no provider configured. Chat runs in offline mode until an API key is set.",
    );
  }

  try {
    await client.listUserOrgs();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Nakama API authentication failed: ${message}\n` +
        "Restart the server so it can provision the local client user:\n" +
        "  bun run dev:server",
    );
    process.exit(1);
  }

  const sessionStore = new SessionStore();
  await sessionStore.load();

  const orgStore = new ChannelOrgStore(getChannelOrgSelectionPath("discord"));
  await orgStore.load();

  const authStore = new DiscordAuthStore();
  await authStore.reload();

  const discord = await createBot(config, {
    client,
    authStore,
    sessionStore,
    orgStore,
  });

  console.log("Nakama Discord bridge running.");
  console.log(`Server: ${serverUrl}`);
  console.log(`Profile: ${config.profileId}`);
  const authConfig = authStore.getConfig();
  const paired = authConfig?.pairedUserIds.length ?? 0;
  const pendingHandshake = authConfig?.handshakeCode ? "yes" : "no";
  console.log(`Paired users: ${paired} · Pending handshake: ${pendingHandshake}`);
  console.log(`Bot: ${discord.user.tag}`);

  clientStop = () => {
    void discord.destroy();
  };

  await writeDiscordWorkerHeartbeat(process.pid, new Date().toISOString(), true);
  heartbeatTimer = setInterval(() => {
    void writeDiscordWorkerHeartbeat(process.pid, new Date().toISOString(), true);
  }, 15_000);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  stopSpawnedServer(spawnedChild);
  process.exit(1);
}

function registerCleanupHandlers(cleanup: () => void): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      cleanup();
      process.exit(0);
    });
  }
}
