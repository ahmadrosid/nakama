import { join } from "node:path";
import { NakamaClient } from "@nakama/client";
import {
  installErrorHandlers,
  installErrorTrackingSink,
  log,
} from "@nakama/core";
import {
  type ChannelOwner,
  channelOwnerFromEnv,
} from "@nakama/core/channel-config-shared";
import { ChannelOrgStore } from "@nakama/core/channel-org";
import { ChannelSessionStore } from "@nakama/core/channel-session-store";
import { ensureServerRunning } from "@nakama/core/ensure-server";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { resolveWebPublicUrl } from "@nakama/core/runtime";
import {
  getWhatsAppConfigDir,
  syncWhatsAppOwnerPairing,
} from "@nakama/core/whatsapp-config";
import {
  createWhatsAppWorkerHeartbeat,
  readWhatsAppHostChannels,
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
import {
  createWhatsAppQrQueue,
  createWhatsAppSocket,
  type WhatsAppSocketHandle,
} from "./socket";

/** The server runs every agent's WhatsApp number in one shared host process. */
const hostMode = process.env.NAKAMA_WHATSAPP_HOST === "1";

if (hostMode) {
  installChannelLogRouting();
}

installErrorHandlers("worker:whatsapp");

void installErrorTrackingSink();

const restoreBaileysConsole = installBaileysConsoleRedaction();

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
  let ownsLease = false;
  const heartbeat = createWhatsAppWorkerHeartbeat(owner);

  const qrCodes = createWhatsAppQrQueue(
    owner,
    () => socketHandle?.generation ?? -1
  );

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
      // Another live bridge owns these files; leave its QR on screen.
      if (ownsLease) {
        // Await before exit — void + process.exit can leave a stale heartbeat/QR file.
        await heartbeat.clear();
        await qrCodes.clear();
      }
    }
  };

  try {
    const config = await loadConfig(owner);

    // The OS lock dies with its process; a heartbeat pid can be reused.
    try {
      await heartbeat.acquire();
    } catch {
      throw new Error("A WhatsApp bridge is already running for this agent.");
    }

    ownsLease = true;
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
        void qrCodes.clear();
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
        void qrCodes.clear();
      },
      onLinkRejected: (message, rejectedOwner) => {
        linkError = message;
        linkOwner = rejectedOwner ?? undefined;
        persistWorkerHeartbeat();
        void qrCodes.clear();
      },
      onMessage: handleMessage,
      onQr: (qr, generation) => {
        void qrCodes.write(qr, generation);
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

let stopChannels: () => Promise<void> = async () => {};

registerProcessLifecycleHandlers(async () => {
  await stopChannels();
  restoreBaileysConsole();
});

try {
  const { serverUrl } = await ensureServerRunning({ spawn: false });

  if (hostMode) {
    const syncChannels = createWhatsAppHost({
      getLogDir: (owner) => getWhatsAppConfigDir(owner),
      start: (owner) => startWhatsAppChannel(owner, serverUrl),
    });

    const poll = async () => syncChannels(await readWhatsAppHostChannels());
    const timer = setInterval(poll, 1000);

    stopChannels = () => {
      clearInterval(timer);

      return syncChannels([]);
    };

    await poll();
    console.log(`Nakama WhatsApp host · ${serverUrl}`);
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
  process.exit(1);
}
