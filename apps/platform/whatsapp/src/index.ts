import { createClient } from "@tinyclaw/client";
import { ensureServerRunning, stopSpawnedServer } from "@tinyclaw/core/ensure-server";
import { loadLocalAuthToken } from "@tinyclaw/core/local-auth";
import {
  clearWhatsAppWorkerHeartbeat,
  writeWhatsAppWorkerHeartbeat,
  writeWhatsAppQrCode,
  clearWhatsAppQrCode,
} from "@tinyclaw/core/whatsapp-worker";
import { syncWhatsAppOwnerPairing } from "@tinyclaw/core/whatsapp-config";
import { createWhatsAppSocket } from "./socket";
import { createChatHandler } from "./chat-handler";
import { loadConfig } from "./config";
import { SessionStore } from "./session-store";
import { WhatsAppAuthStore } from "./auth-store";

let spawnedChild: Bun.Subprocess | null = null;
let socketHandle: { stop: () => void } | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let bridgeConnected = false;

function persistWorkerHeartbeat(): void {
  void writeWhatsAppWorkerHeartbeat(process.pid, new Date().toISOString(), bridgeConnected);
}

registerProcessLifecycleLogging();
registerCleanupHandlers(() => {
  socketHandle?.stop();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  void clearWhatsAppWorkerHeartbeat();
  void clearWhatsAppQrCode();
  stopSpawnedServer(spawnedChild);
});

try {
  const config = await loadConfig();
  const { serverUrl, spawnedChild: child } = await ensureServerRunning();
  spawnedChild = child;

  const client = createClient({
    baseUrl: serverUrl,
    authToken: await loadLocalAuthToken("whatsapp@tinyclaw.internal"),
  });
  const health = await client.health();

  if (!health.providerConfigured) {
    console.warn(
      "Server has no provider configured. Chat runs in offline mode until an API key is set.",
    );
  }

  const sessionStore = new SessionStore();
  await sessionStore.load();

  const authStore = new WhatsAppAuthStore();
  await authStore.reload();

  const handleMessage = createChatHandler({
    client,
    config,
    authStore,
    sessionStore,
    getSocket: () => socketHandle ? (socketHandle as any).socket ?? null : null,
  });

  const socket = await createWhatsAppSocket({
    onMessage: handleMessage,
    onConnected: (me) => {
      bridgeConnected = true;
      persistWorkerHeartbeat();
      console.log("WhatsApp connected.");
      void clearWhatsAppQrCode();
      void syncWhatsAppOwnerPairing({
        ownerJid: me.id,
        ownerLid: me.lid,
      }).then(() => authStore.reload());
    },
    onDisconnected: () => {
      bridgeConnected = false;
      persistWorkerHeartbeat();
    },
    onQr: (qr) => {
      void writeWhatsAppQrCode(qr);
    },
  });

  socketHandle = socket;

  const authConfig = authStore.getConfig();
  const paired = authConfig?.pairedJid ? "yes" : "no";
  const pendingCode = authConfig?.pairingCode ? "yes" : "no";
  console.log(
    `TinyClaw WhatsApp bridge · ${serverUrl} · profile ${config.profileId} · paired ${paired} · pairing code ${pendingCode}`,
  );

  await socket.start();

  await writeWhatsAppWorkerHeartbeat(process.pid, new Date().toISOString(), bridgeConnected);
  heartbeatTimer = setInterval(() => {
    persistWorkerHeartbeat();
  }, 15_000);
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
      console.log(`WhatsApp worker received ${signal}. Shutting down.`);
      cleanup();
      process.exit(0);
    });
  }
}

function registerProcessLifecycleLogging(): void {
  process.on("exit", (code) => {
    console.log(`WhatsApp worker exiting with code ${code}.`);
  });

  process.on("uncaughtException", (error) => {
    console.error("WhatsApp worker uncaught exception.", error);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("WhatsApp worker unhandled rejection.", reason);
  });
}
