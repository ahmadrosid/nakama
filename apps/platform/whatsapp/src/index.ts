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
import {
  getWhatsAppConfigDir,
  syncWhatsAppOwnerPairing,
} from "@nakama/core/whatsapp-config";
import {
  clearWhatsAppQrCode,
  clearWhatsAppWorkerHeartbeat,
  writeWhatsAppQrCode,
  writeWhatsAppWorkerHeartbeat,
} from "@nakama/core/whatsapp-worker";
import { WhatsAppAuthStore } from "./auth-store";
import { createChatHandler } from "./chat-handler";
import { loadConfig } from "./config";
import { startWhatsAppOutboundServer } from "./outbound-server";
import { createWhatsAppSocket } from "./socket";

installErrorHandlers("worker:whatsapp");
void installErrorTrackingSink();

let spawnedChild: Bun.Subprocess | null = null;
let socketHandle: {
  stop: () => void | Promise<void>;
  socket: {
    sendMessage: (jid: string, content: { text: string }) => Promise<unknown>;
  } | null;
} | null = null;
let outboundServer: { port: number; stop: () => void } | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let bridgeConnected = false;

function persistWorkerHeartbeat(): void {
  void writeWhatsAppWorkerHeartbeat(
    process.pid,
    new Date().toISOString(),
    bridgeConnected
  );
}

registerProcessLifecycleLogging();
registerCleanupHandlers(async () => {
  outboundServer?.stop();
  await socketHandle?.stop();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  await clearWhatsAppWorkerHeartbeat();
  await clearWhatsAppQrCode();
  if (hasActiveStreams()) {
    console.warn(
      "Leaving the spawned Nakama server running so in-flight agent turns can finish; the next worker start will reuse it."
    );
  } else {
    stopSpawnedServer(spawnedChild);
  }
});

try {
  const config = await loadConfig();
  const { serverUrl, spawnedChild: child } = await ensureServerRunning();
  spawnedChild = child;

  const client = new NakamaClient({
    authToken:
      (await loadLocalAuthToken("whatsapp@nakama.internal")) ?? undefined,
    baseUrl: serverUrl,
    clientOrigin: resolveWebPublicUrl(),
  });
  const health = await client.health();

  if (!health.providerConfigured) {
    console.warn(
      "Server has no provider configured. Chat runs in offline mode until an API key is set."
    );
  }

  const sessionStore = new ChannelSessionStore(
    join(getWhatsAppConfigDir(), "chat-sessions.json")
  );
  await sessionStore.load();

  const orgStore = new ChannelOrgStore(getChannelOrgSelectionPath("whatsapp"));
  await orgStore.load();

  const authStore = new WhatsAppAuthStore();
  await authStore.reload();

  const handleMessage = createChatHandler({
    authStore,
    client,
    config,
    getSocket: () =>
      socketHandle ? ((socketHandle as any).socket ?? null) : null,
    orgStore,
    sessionStore,
  });

  const socket = await createWhatsAppSocket({
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
    onMessage: handleMessage,
    onQr: (qr) => {
      void writeWhatsAppQrCode(qr);
    },
  });

  socketHandle = socket;

  outboundServer = await startWhatsAppOutboundServer({
    getSendHandle: () => {
      const activeSocket = socketHandle?.socket;

      if (!activeSocket) {
        return null;
      }

      return {
        sendMessage: (jid, content) => activeSocket.sendMessage(jid, content),
      };
    },
  });

  console.log(
    `WhatsApp outbound server listening on 127.0.0.1:${outboundServer.port}`
  );

  const authConfig = authStore.getConfig();
  const paired = authConfig?.pairedJid ? "yes" : "no";
  const pendingCode = authConfig?.pairingCode ? "yes" : "no";
  console.log(
    `Nakama WhatsApp bridge · ${serverUrl} · profile ${config.profileId} · paired ${paired} · pairing code ${pendingCode}`
  );

  await socket.start();

  await writeWhatsAppWorkerHeartbeat(
    process.pid,
    new Date().toISOString(),
    bridgeConnected
  );
  heartbeatTimer = setInterval(() => {
    persistWorkerHeartbeat();
  }, 15_000);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  outboundServer?.stop();
  void clearWhatsAppWorkerHeartbeat();
  void clearWhatsAppQrCode();
  stopSpawnedServer(spawnedChild);
  process.exit(1);
}

function registerCleanupHandlers(cleanup: () => void | Promise<void>): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      console.log(`WhatsApp worker received ${signal}. Shutting down.`);
      void (async () => {
        try {
          await cleanup();
        } finally {
          process.exit(0);
        }
      })();
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
