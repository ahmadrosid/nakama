import { createClient } from "@nakama/client";
import {
  ChannelOrgStore,
  getChannelOrgSelectionPath,
} from "@nakama/core/channel-org";
import { installCrashReportSink, reportError } from "@nakama/core/crash-report";
import {
  ensureServerRunning,
  stopSpawnedServer,
} from "@nakama/core/ensure-server";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { resolveWebPublicUrl } from "@nakama/core/runtime";
import { syncWhatsAppOwnerPairing } from "@nakama/core/whatsapp-config";
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
import { SessionStore } from "./session-store";
import { createWhatsAppSocket } from "./socket";

let spawnedChild: Bun.Subprocess | null = null;
let socketHandle: {
  stop: () => void;
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
installCrashReportSink();
registerCleanupHandlers(() => {
  outboundServer?.stop();
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

  const sessionStore = new SessionStore();
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
  stopSpawnedServer(spawnedChild);
  process.exit(1);
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

  // This worker keeps running after both, unlike the others, because listening at all
  // suppresses Bun's exit(1). That predates crash reporting and is left alone here: a
  // worker that survives in a broken state is caught by the heartbeat check, not by
  // changing crash semantics underneath baileys.
  process.on("uncaughtException", (error) => {
    void reportError(error, { source: "worker:whatsapp" });
  });

  process.on("unhandledRejection", (reason) => {
    void reportError(reason, { source: "worker:whatsapp" });
  });
}
