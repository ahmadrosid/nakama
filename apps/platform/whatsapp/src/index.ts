import { join } from "node:path";
import { NakamaClient } from "@nakama/client";
import {
  installErrorHandlers,
  installErrorTrackingSink,
  log,
} from "@nakama/core";
import { hasActiveStreams } from "@nakama/core/channel-active-stream";
import { channelOwnerFromEnv } from "@nakama/core/channel-config-shared";
import { ChannelOrgStore } from "@nakama/core/channel-org";
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
  createWhatsAppWorkerHeartbeat,
  writeWhatsAppQrCode,
} from "@nakama/core/whatsapp-worker";
import { WhatsAppAuthStore } from "./auth-store";
import { installBaileysConsoleRedaction } from "./baileys-logger";
import { createChatHandler } from "./chat-handler";
import { loadConfig } from "./config";
import { startWhatsAppOutboundServer } from "./outbound-server";
import { registerProcessLifecycleHandlers } from "./process-lifecycle";
import { createWhatsAppSocket } from "./socket";

installErrorHandlers("worker:whatsapp");
void installErrorTrackingSink();
const restoreBaileysConsole = installBaileysConsoleRedaction();

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
const orgId = channelOwnerFromEnv();
const heartbeat = createWhatsAppWorkerHeartbeat(orgId);

function persistWorkerHeartbeat(): void {
  void heartbeat.write({
    connected: bridgeConnected,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  });
}

registerProcessLifecycleHandlers(async () => {
  outboundServer?.stop();
  await socketHandle?.stop();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  await heartbeat.clear();
  await clearWhatsAppQrCode(orgId);
  restoreBaileysConsole();
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
  const existingHeartbeat = await heartbeat.read();
  if (
    existingHeartbeat &&
    existingHeartbeat.pid !== process.pid &&
    heartbeat.isAlive(existingHeartbeat)
  ) {
    console.error(
      "A WhatsApp bridge is already running for this organization."
    );
    process.exit(1);
  }
  await heartbeat.acquire();
  // Publish ownership before server startup can migrate legacy credentials.
  await heartbeat.write({
    connected: false,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  });
  const { serverUrl, spawnedChild: child } = await ensureServerRunning({
    spawn: false,
  });
  spawnedChild = child;

  const client = new NakamaClient({
    authToken:
      (await loadLocalAuthToken("whatsapp@nakama.internal")) ?? undefined,
    baseUrl: serverUrl,
    clientOrigin: resolveWebPublicUrl(),
    orgId: orgId.orgId,
  });
  const health = await client.health();

  if (!health.providerConfigured) {
    console.warn(
      "Server has no provider configured. Chat runs in offline mode until an API key is set."
    );
  }

  const sessionStore = new ChannelSessionStore(
    join(getWhatsAppConfigDir(orgId), "chat-sessions.json")
  );
  await sessionStore.load();

  const orgStore = new ChannelOrgStore(
    join(getWhatsAppConfigDir(orgId), "org-selection.json")
  );
  await orgStore.load();

  const authStore = new WhatsAppAuthStore(orgId);
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
      log("info", "worker.connected", { worker: "whatsapp" });
      void clearWhatsAppQrCode(orgId);
      void syncWhatsAppOwnerPairing(
        {
          ownerJid: me.id,
          ownerLid: me.lid,
        },
        orgId
      ).then(() => authStore.reload());
    },
    onDisconnected: () => {
      bridgeConnected = false;
      persistWorkerHeartbeat();
    },
    onMessage: handleMessage,
    onQr: (qr) => {
      void writeWhatsAppQrCode(qr, orgId);
    },
    orgId,
  });

  socketHandle = socket;

  outboundServer = await startWhatsAppOutboundServer({
    getSendHandle: () => {
      const activeSocket = socketHandle?.socket;

      if (!(activeSocket && bridgeConnected)) {
        return null;
      }

      return {
        sendMessage: (jid, content) => activeSocket.sendMessage(jid, content),
      };
    },
    orgId,
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

  await heartbeat.write({
    connected: bridgeConnected,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  });
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
  try {
    await socketHandle?.stop();
  } catch {
    // Socket stop best-effort on fatal path.
  }
  // Await before exit — void + process.exit can leave a stale heartbeat/QR file.
  await heartbeat.clear();
  await clearWhatsAppQrCode(orgId);
  stopSpawnedServer(spawnedChild);
  process.exit(1);
}
