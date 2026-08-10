import { getWhatsAppConfigDir } from "@nakama/core/whatsapp-config";
import {
  DisconnectReason,
  extractMessageContent,
  fetchLatestBaileysVersion,
  getContentType,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import {
  extractInboundText,
  isPrivateWhatsAppChat,
  shouldHandleInboundMessage,
} from "./inbound-message";

export interface WhatsAppSocketDeps {
  onConnected?: (me: { id: string; lid?: string | null }) => void;
  onDisconnected?: () => void;
  onMessage: (data: { jid: string; text: string }) => Promise<void>;
  onQr?: (qr: string) => void;
}

export interface WhatsAppSocketHandle {
  socket: WASocket | null;
  start: () => Promise<void>;
  stop: () => void;
}

export async function createWhatsAppSocket(
  deps: WhatsAppSocketDeps
): Promise<WhatsAppSocketHandle> {
  const authDir = getWhatsAppConfigDir() + "/auth";
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  let socket: WASocket | null = null;
  let stopped = false;
  let loggedMissingTextPayload = false;
  const baileysLogger = createBaileysLogger();

  const handle = {
    get socket() {
      return socket;
    },
    async start() {
      if (stopped) {
        return;
      }

      socket = makeWASocket({
        auth: state,
        browser: ["Nakama", "Chrome", "4.0.0"] as [string, string, string],
        connectTimeoutMs: 30_000,
        logger: baileysLogger,
        markOnlineOnConnect: false,
        printQRInTerminal: false,
        retryRequestDelayMs: 2000,
        // Keep history sync disabled, but allow Baileys init queries so the
        // socket fully subscribes after reconnect/restart.
        shouldSyncHistoryMessage: () => false,
        version,
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
            `WhatsApp disconnected (code: ${statusCode}).${shouldReconnect ? " Reconnecting..." : ""}`
          );

          if (shouldReconnect) {
            await handle.start();
          }
        }
      });

      socket.ev.on("creds.update", saveCreds);

      socket.ev.on("messages.upsert", async (m) => {
        console.log(
          `WhatsApp messages.upsert type=${m.type} count=${m.messages.length}`
        );

        if (!isSupportedUpsertType(m.type)) {
          return;
        }

        const me = state.creds.me;

        for (const msg of m.messages) {
          const remoteJid = msg.key.remoteJid ?? null;
          const text = extractInboundText(msg.message);
          const shouldHandle = shouldHandleInboundMessage(msg, me);

          if (remoteJid) {
            console.log(
              `WhatsApp upsert item jid=${remoteJid} fromMe=${msg.key.fromMe ? "yes" : "no"} participant=${msg.key.participant ?? "-"} text=${text ? "yes" : "no"} handle=${shouldHandle ? "yes" : "no"}`
            );
          }

          if (
            remoteJid &&
            !text &&
            !loggedMissingTextPayload &&
            isPrivateWhatsAppChat(remoteJid)
          ) {
            loggedMissingTextPayload = true;
            console.log(
              "WhatsApp missing-text payload:",
              summarizeMissingTextPayload(msg)
            );
          }

          if (!(shouldHandle && remoteJid)) {
            continue;
          }

          const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
          console.log(
            `WhatsApp message received from ${remoteJid}: ${preview}`
          );

          try {
            await deps.onMessage({ jid: remoteJid, text });
          } catch (error) {
            console.error("WhatsApp inbound message handling failed.", {
              error: error instanceof Error ? error.message : String(error),
              jid: remoteJid,
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

function isSupportedUpsertType(type: string): boolean {
  return type === "notify" || type === "append";
}

function summarizeMissingTextPayload(msg: {
  key: {
    remoteJid?: string | null;
    fromMe?: boolean | null;
    participant?: string | null;
    id?: string | null;
  };
  message?: Record<string, unknown> | null;
  messageStubType?: unknown;
}): string {
  const extracted = extractMessageContent(msg.message as any);
  const summary = {
    extractedKeys: extracted ? Object.keys(extracted).slice(0, 10) : [],
    extractedType: getContentType(extracted as any) ?? null,
    key: {
      fromMe: msg.key.fromMe ?? null,
      id: msg.key.id ?? null,
      participant: msg.key.participant ?? null,
      remoteJid: msg.key.remoteJid ?? null,
    },
    message: msg.message ?? null,
    messageStubType: msg.messageStubType ?? null,
    topLevelKeys: msg.message ? Object.keys(msg.message).slice(0, 10) : [],
    topLevelType: getContentType(msg.message as any) ?? null,
  };

  return JSON.stringify(summary);
}

// ponytail: keep Baileys on silent; worker logs what matters itself
function createBaileysLogger() {
  const noop = () => {};
  const logger = {
    child: () => logger,
    debug: noop,
    error: console.error.bind(console),
    fatal: console.error.bind(console),
    info: noop,
    level: "silent",
    trace: noop,
    warn: console.warn.bind(console),
  };

  return logger;
}
