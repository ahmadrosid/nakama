import { join } from "node:path";
import { NakamaClient } from "@nakama/client";
import {
  installErrorHandlers,
  installErrorTrackingSink,
  log,
} from "@nakama/core";
import { hasActiveStreams } from "@nakama/core/channel-active-stream";
import { ChannelOrgStore } from "@nakama/core/channel-org";
import { ChannelSessionStore } from "@nakama/core/channel-session-store";
import {
  ensureServerRunning,
  stopSpawnedServer,
} from "@nakama/core/ensure-server";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { resolveWebPublicUrl } from "@nakama/core/runtime";
import { getTelegramConfigDir } from "@nakama/core/telegram-config";
import {
  createTelegramWorkerHeartbeat,
  isHeartbeatAlive,
} from "@nakama/core/telegram-worker";
import { TelegramAuthStore } from "./auth-store";
import { createBot } from "./bot";
import { loadTelegramIdentities, type TelegramBridgeConfig } from "./config";

installErrorHandlers("worker:telegram");
void installErrorTrackingSink();

type StartedIdentity = {
  clearHeartbeat: () => Promise<void>;
  stop: () => void;
  writeHeartbeat: () => Promise<void>;
};

let spawnedChild: Bun.Subprocess | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const started: StartedIdentity[] = [];

registerCleanupHandlers(() => {
  stopAll();
  if (hasActiveStreams()) {
    console.warn(
      "Leaving the spawned Nakama server running so in-flight agent turns can finish; the next worker start will reuse it."
    );
  } else {
    stopSpawnedServer(spawnedChild);
  }
});

try {
  const identities = await loadTelegramIdentities();
  const { serverUrl, spawnedChild: child } = await ensureServerRunning();
  spawnedChild = child;

  const authToken =
    (await loadLocalAuthToken("telegram@nakama.internal")) ?? undefined;
  const probe = new NakamaClient({
    authToken,
    baseUrl: serverUrl,
    clientOrigin: resolveWebPublicUrl(),
  });
  const health = await probe.health();

  try {
    await probe.listUserOrgs();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Nakama API authentication failed: ${message}\n` +
        "Restart the server so it can provision the local client user:\n" +
        "  bun run dev:server"
    );
    process.exit(1);
  }

  if (!health.providerConfigured) {
    console.warn(
      "Server has no provider configured. Chat runs in offline mode until an API key is set."
    );
  }

  const running: Promise<void>[] = [];

  for (const config of identities) {
    const bot = await startIdentity(config, serverUrl, authToken);

    if (bot) {
      running.push(bot);
    }
  }

  if (running.length === 0) {
    console.error(
      "Every configured Telegram bot is already claimed by a running bridge."
    );
    process.exit(1);
  }

  log("info", "worker.started", {
    count: running.length,
    worker: "telegram",
  });
  console.log(`Server: ${serverUrl}`);

  heartbeatTimer = setInterval(() => {
    for (const identity of started) {
      void identity.writeHeartbeat();
    }
  }, 15_000);

  await Promise.all(running);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  stopAll();
  // Await before exit: void + process.exit can leave a stale heartbeat file.
  await Promise.all(started.map((identity) => identity.clearHeartbeat()));
  stopSpawnedServer(spawnedChild);
  process.exit(1);
} finally {
  stopSpawnedServer(spawnedChild);
}

/**
 * Starts one bot for one config scope, or returns null when another process
 * already holds that identity. Telegram drops updates for whichever poller is
 * not last, so a second claim has to be refused rather than raced.
 */
async function startIdentity(
  config: TelegramBridgeConfig,
  serverUrl: string,
  authToken: string | undefined
): Promise<Promise<void> | null> {
  const label = config.orgId ? `org ${config.orgId}` : "install-wide config";
  const heartbeat = createTelegramWorkerHeartbeat(config.orgId);
  const existing = await heartbeat.read();

  if (existing && existing.pid !== process.pid && isHeartbeatAlive(existing)) {
    console.error(
      `Another Nakama Telegram bridge already runs the ${label} bot (pid ${existing.pid}). Skipping it.`
    );
    return null;
  }

  const configDir = getTelegramConfigDir(config.orgId);
  const client = new NakamaClient({
    authToken,
    baseUrl: serverUrl,
    clientOrigin: resolveWebPublicUrl(),
  });

  const sessionStore = new ChannelSessionStore(
    join(configDir, "chat-sessions.json")
  );
  await sessionStore.load();

  const orgStore = new ChannelOrgStore(join(configDir, "org-selection.json"));
  await orgStore.load();

  const authStore = new TelegramAuthStore(config.orgId);
  await authStore.reload();

  const bot = await createBot(config, {
    authStore,
    client,
    orgStore,
    sessionStore,
  });

  const writeHeartbeat = () =>
    heartbeat.write({ pid: process.pid, updatedAt: new Date().toISOString() });

  started.push({
    clearHeartbeat: heartbeat.clear,
    stop: () => bot.stop(),
    writeHeartbeat,
  });

  await writeHeartbeat();

  const authConfig = authStore.getConfig();
  console.log(
    `${label}: profile ${config.profileId} · paired ${authConfig?.pairedUserIds.length ?? 0} · pending handshake ${authConfig?.handshakeCode ? "yes" : "no"}`
  );

  return bot.start({
    onStart: (info) => {
      console.log(`Bot @${info.username} is listening for ${label}.`);
    },
  });
}

function stopAll(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  for (const identity of started) {
    identity.stop();
    void identity.clearHeartbeat();
  }
}

function registerCleanupHandlers(cleanup: () => void): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      cleanup();
      process.exit(0);
    });
  }
}
