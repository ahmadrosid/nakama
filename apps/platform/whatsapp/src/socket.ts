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
  onDisconnected?: () => void;
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
  const baileysLogger = createBaileysLogger();

  const handle = {
    get socket() {
      return socket;
    },
    async start() {
      if (stopped) return;

      socket = makeWASocket({
        version,
        auth: state,
        logger: baileysLogger,
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
          const me = state.creds.me;
          if (me?.id) {
            deps.onConnected?.({ id: me.id, lid: me.lid ?? null });
          }
        }

        if (connection === "close") {
          deps.onDisconnected?.();
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
          const remoteJid = msg.key.remoteJid ?? null;
          const text = extractInboundText(msg.message);
          const shouldHandle = shouldHandleInboundMessage(msg, me);

          if (!shouldHandle || !remoteJid) continue;

          const preview =
            text.length > 120 ? `${text.slice(0, 120)}…` : text;
          console.log(`WhatsApp message received from ${remoteJid}: ${preview}`);

          try {
            await deps.onMessage({ jid: remoteJid, text });
          } catch (error) {
            console.error("WhatsApp inbound message handling failed.", {
              jid: remoteJid,
              error: error instanceof Error ? error.message : String(error),
            });
          }
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

// ponytail: keep Baileys on silent; worker logs what matters itself
function createBaileysLogger() {
  const noop = () => {};
  const logger = {
    level: "silent",
    trace: noop,
    debug: noop,
    info: noop,
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    fatal: console.error.bind(console),
    child: () => logger,
  };

  return logger;
}
