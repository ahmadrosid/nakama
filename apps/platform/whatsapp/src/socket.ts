import {
  type WASocket,
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import {
  getWhatsAppConfigDir,
} from "@tinyclaw/core/whatsapp-config";
import {
  extractInboundText,
  shouldHandleInboundMessage,
} from "./inbound-message";

export interface WhatsAppSocketDeps {
  onMessage: (data: { jid: string; text: string }) => Promise<void>;
  onConnected?: (me: { id: string; lid?: string | null }) => void;
  onQr?: (qr: string) => void;
}

export interface WhatsAppSocketHandle {
  socket: WASocket | null;
  start: () => Promise<void>;
  stop: () => void;
}

export async function createWhatsAppSocket(
  deps: WhatsAppSocketDeps,
): Promise<WhatsAppSocketHandle> {
  const authDir = getWhatsAppConfigDir() + "/auth";
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  let socket: WASocket | null = null;
  let stopped = false;

  const handle = {
    get socket() {
      return socket;
    },
    async start() {
      if (stopped) return;

      socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ["TinyClaw", "Chrome", "4.0.0"] as [string, string, string],
        connectTimeoutMs: 30_000,
        retryRequestDelayMs: 2_000,
        // ponytail: bridge only needs live messages; skip history + init IQs that race on connect
        fireInitQueries: false,
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: false,
      });

      socket.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          deps.onQr?.(qr);
        }

        if (connection === "open") {
          console.log("WhatsApp connected.");
          const me = state.creds.me;
          if (me?.id) {
            deps.onConnected?.({ id: me.id, lid: me.lid ?? null });
          }
        }

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.message
            ? (lastDisconnect.error as any)?.output?.statusCode
            : lastDisconnect?.statusCode;
          const shouldReconnect =
            statusCode !== DisconnectReason.loggedOut && !stopped;

          console.log(
            `WhatsApp disconnected (code: ${statusCode}).${shouldReconnect ? " Reconnecting..." : ""}`,
          );

          if (shouldReconnect) {
            await handle.start();
          }
        }
      });

      socket.ev.on("creds.update", saveCreds);

      socket.ev.on("messages.upsert", async (m) => {
        if (m.type !== "notify") return;

        const me = state.creds.me;

        for (const msg of m.messages) {
          if (!shouldHandleInboundMessage(msg, me)) continue;

          const jid = msg.key.remoteJid!;
          const text = extractInboundText(msg.message);

          await deps.onMessage({ jid, text });
        }
      });
    },
    stop() {
      stopped = true;
      if (socket) {
        socket.end(undefined);
        socket = null;
      }
    },
  };

  return handle;
}
