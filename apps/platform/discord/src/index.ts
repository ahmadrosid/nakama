import { join } from "node:path";
import { NakamaClient } from "@nakama/client";
import { installErrorHandlers, installErrorTrackingSink } from "@nakama/core";
import { hasActiveStreams } from "@nakama/core/channel-active-stream";
import {
  ChannelOrgStore,
  getChannelOrgSelectionPath,
} from "@nakama/core/channel-org";
import { ChannelSessionStore } from "@nakama/core/channel-session-store";
import { getDiscordConfigDir } from "@nakama/core/discord-config";
import {
  clearDiscordWorkerHeartbeat,
  isHeartbeatAlive,
  readDiscordWorkerHeartbeat,
  writeDiscordWorkerHeartbeat,
} from "@nakama/core/discord-worker";
import {
  ensureServerRunning,
  stopSpawnedServer,
} from "@nakama/core/ensure-server";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { resolveWebPublicUrl } from "@nakama/core/runtime";
import { DiscordAuthStore } from "./auth-store";
import { createBot } from "./bot";
import { loadConfig } from "./config";
import { ThreadStore } from "./thread-store";

installErrorHandlers("worker:discord");
void installErrorTrackingSink();

let spawnedChild: Bun.Subprocess | null = null;
let clientStop: (() => void | Promise<void>) | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

registerCleanupHandlers(async () => {
  await clientStop?.();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  void clearDiscordWorkerHeartbeat();
  if (hasActiveStreams()) {
    console.warn(
      "Leaving the spawned Nakama server running so in-flight agent turns can finish; the next worker start will reuse it."
    );
  } else {
    stopSpawnedServer(spawnedChild);
  }
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
        "Stop the existing bridge worker or disable it in the dashboard before starting a new one."
    );
    process.exit(1);
  }

  const config = await loadConfig();
  const { serverUrl, spawnedChild: child } = await ensureServerRunning();
  spawnedChild = child;

  const client = new NakamaClient({
    authToken:
      (await loadLocalAuthToken("discord@nakama.internal")) ?? undefined,
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
    join(getDiscordConfigDir(), "chat-sessions.json")
  );
  await sessionStore.load();

  const threadStore = new ThreadStore();
  await threadStore.load();

  const orgStore = new ChannelOrgStore(getChannelOrgSelectionPath("discord"));
  await orgStore.load();

  const authStore = new DiscordAuthStore();
  await authStore.reload();

  const discord = await createBot(config, {
    authStore,
    client,
    orgStore,
    sessionStore,
    threadStore,
  });

  console.log("Nakama Discord bridge running.");
  console.log(`Server: ${serverUrl}`);
  console.log(`Profile: ${config.profileId}`);
  const authConfig = authStore.getConfig();
  const paired = authConfig?.pairedUserIds.length ?? 0;
  const pendingHandshake = authConfig?.handshakeCode ? "yes" : "no";
  console.log(
    `Paired users: ${paired} · Pending handshake: ${pendingHandshake}`
  );
  console.log(`Bot: ${discord.user.tag}`);

  // Assign before heartbeat so failure paths can always destroy the client.
  clientStop = async () => {
    await discord.destroy();
  };

  await writeDiscordWorkerHeartbeat(
    process.pid,
    new Date().toISOString(),
    true
  );
  heartbeatTimer = setInterval(() => {
    void writeDiscordWorkerHeartbeat(
      process.pid,
      new Date().toISOString(),
      true
    );
  }, 15_000);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  void clearDiscordWorkerHeartbeat();
  stopSpawnedServer(spawnedChild);
  process.exit(1);
}

function registerCleanupHandlers(cleanup: () => void | Promise<void>): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, async () => {
      try {
        await cleanup();
      } finally {
        process.exit(0);
      }
    });
  }
}
