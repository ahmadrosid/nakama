import { join } from "node:path";
import { NakamaClient } from "@nakama/client";
import { installErrorHandlers, installErrorTrackingSink } from "@nakama/core";
import { hasActiveStreams } from "@nakama/core/channel-active-stream";
import {
  ChannelOrgStore,
  getChannelOrgSelectionPath,
} from "@nakama/core/channel-org";
import { ChannelSessionStore } from "@nakama/core/channel-session-store";
import {
  ensureServerRunning,
  stopSpawnedServer,
} from "@nakama/core/ensure-server";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { resolveWebPublicUrl } from "@nakama/core/runtime";
import { getTelegramConfigDir } from "@nakama/core/telegram-config";
import {
  clearTelegramWorkerHeartbeat,
  isHeartbeatAlive,
  readTelegramWorkerHeartbeat,
  writeTelegramWorkerHeartbeat,
} from "@nakama/core/telegram-worker";
import { TelegramAuthStore } from "./auth-store";
import { createBot } from "./bot";
import { loadConfig } from "./config";

installErrorHandlers("worker:telegram");
void installErrorTrackingSink();

let spawnedChild: Bun.Subprocess | null = null;
let botStop: (() => void) | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

registerCleanupHandlers(() => {
  botStop?.();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  void clearTelegramWorkerHeartbeat();
  if (hasActiveStreams()) {
    console.warn(
      "Leaving the spawned Nakama server running so in-flight agent turns can finish; the next worker start will reuse it."
    );
  } else {
    stopSpawnedServer(spawnedChild);
  }
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
        "Stop the existing bridge worker or disable it in the dashboard before starting a new one."
    );
    process.exit(1);
  }

  const config = await loadConfig();
  const { serverUrl, spawnedChild: child } = await ensureServerRunning();
  spawnedChild = child;

  const client = new NakamaClient({
    authToken:
      (await loadLocalAuthToken("telegram@nakama.internal")) ?? undefined,
    baseUrl: serverUrl,
    clientOrigin: resolveWebPublicUrl(),
  });
  const health = await client.health();

  if (!health.providerConfigured) {
    console.warn(
      "Server has no provider configured. Chat runs in offline mode until an API key is set."
    );
  }

  try {
    await client.listUserOrgs();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Nakama API authentication failed: ${message}\n` +
        "Restart the server so it can provision the local client user:\n" +
        "  bun run dev:server"
    );
    process.exit(1);
  }

  const sessionStore = new ChannelSessionStore(
    join(getTelegramConfigDir(), "chat-sessions.json")
  );
  await sessionStore.load();

  const orgStore = new ChannelOrgStore(getChannelOrgSelectionPath("telegram"));
  await orgStore.load();

  const authStore = new TelegramAuthStore();
  await authStore.reload();

  const bot = await createBot(config, {
    authStore,
    client,
    orgStore,
    sessionStore,
  });

  console.log("Nakama Telegram bridge running (long polling).");
  console.log(`Server: ${serverUrl}`);
  console.log(`Profile: ${config.profileId}`);
  const authConfig = authStore.getConfig();
  const paired = authConfig?.pairedUserIds.length ?? 0;
  const pendingHandshake = authConfig?.handshakeCode ? "yes" : "no";
  console.log(
    `Paired users: ${paired} · Pending handshake: ${pendingHandshake}`
  );

  // Assign before start/heartbeat so failure paths can always stop the bot.
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
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  botStop?.();
  void clearTelegramWorkerHeartbeat();
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
