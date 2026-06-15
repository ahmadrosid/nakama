import { createClient } from "@tinyclaw/client";
import { ensureServerRunning, stopSpawnedServer } from "@tinyclaw/core/ensure-server";
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

  const client = createClient({ baseUrl: serverUrl });
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
      console.log("WhatsApp bridge is listening for messages.");
      void clearWhatsAppQrCode();
      void syncWhatsAppOwnerPairing({
        ownerJid: me.id,
        ownerLid: me.lid,
      }).then(() => authStore.reload());
    },
    onQr: (qr) => {
      void writeWhatsAppQrCode(qr);
    },
  });

  socketHandle = socket;

  console.log("TinyClaw WhatsApp bridge starting.");
  console.log(`Server: ${serverUrl}`);
  console.log(`Profile: ${config.profileId}`);
  const authConfig = authStore.getConfig();
  const paired = authConfig?.pairedJid ? "yes" : "no";
  const pendingCode = authConfig?.pairingCode ? "yes" : "no";
  console.log(`Paired: ${paired} \u00b7 Pending pairing code: ${pendingCode}`);

  await socket.start();

  await writeWhatsAppWorkerHeartbeat();
  heartbeatTimer = setInterval(() => {
    void writeWhatsAppWorkerHeartbeat();
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
      cleanup();
      process.exit(0);
    });
  }
}