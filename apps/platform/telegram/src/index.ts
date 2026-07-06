import { createClient } from "@nakama/client";
import { ChannelOrgStore, getChannelOrgSelectionPath } from "@nakama/core/channel-org";
import { ensureServerRunning, stopSpawnedServer } from "@nakama/core/ensure-server";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import {
  clearTelegramWorkerHeartbeat,
  isHeartbeatAlive,
  readTelegramWorkerHeartbeat,
  writeTelegramWorkerHeartbeat,
} from "@nakama/core/telegram-worker";
import { TelegramAuthStore } from "./auth-store";
import { createBot } from "./bot";
import { loadConfig } from "./config";
import { SessionStore } from "./session-store";

let spawnedChild: Bun.Subprocess | null = null;
let botStop: (() => void) | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

registerCleanupHandlers(() => {
  botStop?.();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  void clearTelegramWorkerHeartbeat();
  stopSpawnedServer(spawnedChild);
});

try {
  const existingHeartbeat = await readTelegramWorkerHeartbeat();

  if (
    existingHeartbeat &&
    existingHeartbeat.pid !== process.pid &&
    isHeartbeatAlive(existingHeartbeat)
  ) {
    console.error(
      `Another Nakama Telegram bridge is already running (pid ${existingHeartbeat.pid}). ` +
        "Stop the existing bridge worker or disable it in the dashboard before starting a new one.",
    );
    process.exit(1);
  }

  const config = await loadConfig();
  const { serverUrl, spawnedChild: child } = await ensureServerRunning();
  spawnedChild = child;

  const client = createClient({
    baseUrl: serverUrl,
    authToken: await loadLocalAuthToken("telegram@nakama.internal"),
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

  const orgStore = new ChannelOrgStore(getChannelOrgSelectionPath("telegram"));
  await orgStore.load();

  const authStore = new TelegramAuthStore();
  await authStore.reload();

  const bot = await createBot(config, {
    client,
    sessionStore,
    authStore,
    orgStore,
  });

  console.log("Nakama Telegram bridge running (long polling).");
  console.log(`Server: ${serverUrl}`);
  console.log(`Profile: ${config.profileId}`);
  const authConfig = authStore.getConfig();
  const paired = authConfig?.pairedUserIds.length ?? 0;
  const pendingHandshake = authConfig?.handshakeCode ? "yes" : "no";
  console.log(`Paired users: ${paired} · Pending handshake: ${pendingHandshake}`);

  botStop = () => bot.stop();

  await writeTelegramWorkerHeartbeat();
  heartbeatTimer = setInterval(() => {
    void writeTelegramWorkerHeartbeat();
  }, 15_000);

  await bot.start({
    onStart: (info) => {
      console.log(`Bot @${info.username} is listening.`);
    },
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
} finally {
  stopSpawnedServer(spawnedChild);
}

function registerCleanupHandlers(cleanup: () => void): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      cleanup();
      process.exit(0);
    });
  }
}
