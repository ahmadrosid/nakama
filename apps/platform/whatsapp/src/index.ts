import { join } from "node:path";
import { NakamaClient } from "@nakama/client";
import {
  installErrorHandlers,
  installErrorTrackingSink,
  log,
} from "@nakama/core";
import { hasActiveStreams } from "@nakama/core/channel-active-stream";
import {
  type ChannelOwner,
  channelOwnerFromEnv,
} from "@nakama/core/channel-config-shared";
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
  readWhatsAppHostChannels,
  writeWhatsAppQrCode,
} from "@nakama/core/whatsapp-worker";
import { WhatsAppAuthStore } from "./auth-store";
import { installBaileysConsoleRedaction } from "./baileys-logger";
import { createChatHandler } from "./chat-handler";
import { loadConfig } from "./config";
import {
  createWhatsAppHost,
  installChannelLogRouting,
  type WhatsAppChannelHandle,
} from "./host";
import { startWhatsAppOutboundServer } from "./outbound-server";
import { registerProcessLifecycleHandlers } from "./process-lifecycle";
import { createWhatsAppSocket, type WhatsAppSocketHandle } from "./socket";

/** The server runs every agent's WhatsApp number in one shared host process. */
const hostMode = process.env.NAKAMA_WHATSAPP_HOST === "1";

if (hostMode) {
  installChannelLogRouting();
}

installErrorHandlers("worker:whatsapp");

void installErrorTrackingSink();

const restoreBaileysConsole = installBaileysConsoleRedaction();

let spawnedChild: Bun.Subprocess | null = null;

async function startWhatsAppChannel(
  owner: ChannelOwner,
  serverUrl: string
): Promise<WhatsAppChannelHandle> {
  let socketHandle: WhatsAppSocketHandle | null = null;
  let outboundServer: { port: number; stop: () => void } | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let bridgeConnected = false;
  let linkError: string | undefined;
  let linkOwner: ChannelOwner | undefined;
  const heartbeat = createWhatsAppWorkerHeartbeat(owner);

  const persistWorkerHeartbeat = () => {
    void heartbeat.write({
      connected: bridgeConnected,
      linkError,
      linkOwner,
      pid: process.pid,
      updatedAt: new Date().toISOString(),
    });
  };

  const stop = async () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    outboundServer?.stop();

    try {
      await socketHandle?.stop();
    } finally {
      // Await before exit — void + process.exit can leave a stale heartbeat/QR file.
      await heartbeat.clear();
      await clearWhatsAppQrCode(owner);
    }
  };

  try {
    const config = await loadConfig(owner);
    const existingHeartbeat = await heartbeat.read();

    if (
      existingHeartbeat &&
      existingHeartbeat.pid !== process.pid &&
      heartbeat.isAlive(existingHeartbeat)
    ) {
      throw new Error("A WhatsApp bridge is already running for this agent.");
    }

    await heartbeat.acquire();
    // Publish ownership before server startup can migrate legacy credentials.
    await heartbeat.write({
      connected: false,
      pid: process.pid,
      updatedAt: new Date().toISOString(),
    });

    const client = new NakamaClient({
      authToken:
        (await loadLocalAuthToken("whatsapp@nakama.internal")) ?? undefined,
      baseUrl: serverUrl,
      clientOrigin: resolveWebPublicUrl(),
      orgId: owner.orgId,
    });

    const health = await client.health();

    if (!health.providerConfigured) {
      console.warn(
        "Server has no provider configured. Chat runs in offline mode until an API key is set."
      );
    }

    const sessionStore = new ChannelSessionStore(
      join(getWhatsAppConfigDir(owner), "chat-sessions.json")
    );

    await sessionStore.load();

    const orgStore = new ChannelOrgStore(
      join(getWhatsAppConfigDir(owner), "org-selection.json")
    );

    await orgStore.load();

    const authStore = new WhatsAppAuthStore(owner);
    await authStore.reload();

    const handleMessage = createChatHandler({
      authStore,
      client,
      config,
      getSocket: () => socketHandle?.socket ?? null,
      orgStore,
      sessionStore,
      whatsappContextToken: process.env.NAKAMA_WHATSAPP_CONTEXT_TOKEN,
    });

    const socket = await createWhatsAppSocket({
      onConnected: (me) => {
        bridgeConnected = true;
        linkError = undefined;
        linkOwner = undefined;
        persistWorkerHeartbeat();
        log("info", "worker.connected", { worker: "whatsapp" });
        void clearWhatsAppQrCode(owner);
        void syncWhatsAppOwnerPairing(
          {
            ownerJid: me.id,
            ownerLid: me.lid,
          },
          owner
        ).then(() => authStore.reload());
      },
      onDisconnected: () => {
        bridgeConnected = false;
        persistWorkerHeartbeat();
        // A closed socket's QR code can no longer be scanned.
        void clearWhatsAppQrCode(owner);
      },
      onLinkRejected: (message, rejectedOwner) => {
        linkError = message;
        linkOwner = rejectedOwner ?? undefined;
        persistWorkerHeartbeat();
        void clearWhatsAppQrCode(owner);
      },
      onMessage: handleMessage,
      onQr: (qr) => {
        void writeWhatsAppQrCode(qr, owner);
      },
      orgId: owner,
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
      orgId: owner,
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

    persistWorkerHeartbeat();
    heartbeatTimer = setInterval(persistWorkerHeartbeat, 15_000);

    return { stop };
  } catch (error) {
    try {
      await stop();
    } catch {
      // Stop is best-effort on the failure path; the start error matters.
    }

    throw error;
  }
}

const HOST_POLL_MS = 1000;

let hostTimer: ReturnType<typeof setInterval> | null = null;

let stopChannels: () => Promise<void> = async () => {};

registerProcessLifecycleHandlers(async () => {
  if (hostTimer) {
    clearInterval(hostTimer);
  }

  await stopChannels();
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
  const { serverUrl, spawnedChild: child } = await ensureServerRunning({
    spawn: false,
  });

  spawnedChild = child;

  if (hostMode) {
    const host = createWhatsAppHost({
      getLogDir: (owner) => getWhatsAppConfigDir(owner),
      readOwners: readWhatsAppHostChannels,
      start: (owner) => startWhatsAppChannel(owner, serverUrl),
    });

    stopChannels = host.stopAll;
    await host.reconcile();
    hostTimer = setInterval(() => {
      void host.reconcile();
    }, HOST_POLL_MS);
    console.log(
      `Nakama WhatsApp host · ${serverUrl} · ${host.runningCount()} channels`
    );
  } else {
    const channel = await startWhatsAppChannel(
      channelOwnerFromEnv(),
      serverUrl
    );

    stopChannels = channel.stop;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  stopSpawnedServer(spawnedChild);
  process.exit(1);
}
