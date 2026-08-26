import { getWhatsAppConfigDir } from "@nakama/core/whatsapp-config";
import {
  DisconnectReason,
  extractMessageContent,
  fetchLatestBaileysVersion,
  getContentType,
  makeWASocket,
  type WASocket,
} from "@whiskeysockets/baileys";
import { usePrivateMultiFileAuthState } from "./auth-state";
import { createBaileysLogger } from "./baileys-logger";
import {
  extractInboundText,
  isPrivateWhatsAppChat,
  parseInboundWhatsAppMessage,
  type WhatsAppInboundChat,
} from "./inbound-message";

export interface WhatsAppSocketDeps {
  onConnected?: (me: { id: string; lid?: string | null }) => void;
  onDisconnected?: () => void;
  onMessage: (data: WhatsAppInboundChat) => Promise<void>;
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
  const { state, saveCreds } = await usePrivateMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  let socket: WASocket | null = null;
  let stopped = false;
  let generation = 0;
  let reconnectAttempt = 0;
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

      const myGen = ++generation;
      const previous = socket;
      socket = null;
      previous?.end(undefined);

      const next = makeWASocket({
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

      if (myGen !== generation || stopped) {
        next.end(undefined);
        return;
      }

      socket = next;

      next.ev.on("connection.update", async (update) => {
        if (myGen !== generation) {
          return;
        }

        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          deps.onQr?.(qr);
        }

        if (connection === "open") {
          reconnectAttempt = 0;
          const me = state.creds.me;
          if (me?.id) {
            deps.onConnected?.({ id: me.id, lid: me.lid ?? null });
          }
        }

        if (connection === "close") {
          generation += 1;
          deps.onDisconnected?.();
          const statusCode = lastDisconnect?.error?.message
            ? (lastDisconnect.error as { output?: { statusCode?: number } })
                .output?.statusCode
            : lastDisconnect?.statusCode;
          const shouldReconnect =
            statusCode !== DisconnectReason.loggedOut && !stopped;

          console.log(
            `WhatsApp disconnected (code: ${statusCode}).${shouldReconnect ? " Reconnecting..." : ""}`
          );

          if (!shouldReconnect) {
            return;
          }

          const waitMs = Math.min(
            30_000,
            1000 * 2 ** Math.min(reconnectAttempt, 5)
          );
          reconnectAttempt += 1;
          await new Promise<void>((resolve) => {
            setTimeout(resolve, waitMs);
          });
          if (stopped) {
            return;
          }

          await handle.start();
        }
      });

      next.ev.on("creds.update", saveCreds);

      next.ev.on("messages.upsert", async (m) => {
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
          const inbound = parseInboundWhatsAppMessage(msg, me);

          if (remoteJid) {
            console.log(
              `WhatsApp upsert item jid=${remoteJid} fromMe=${msg.key.fromMe ? "yes" : "no"} participant=${msg.key.participant ?? "-"} text=${text ? "yes" : "no"} handle=${inbound ? "yes" : "no"}`
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

          if (!inbound) {
            continue;
          }

          const preview =
            inbound.text.length > 120
              ? `${inbound.text.slice(0, 120)}…`
              : inbound.text;
          console.log(
            `WhatsApp message received from ${inbound.jid}: ${preview}`
          );

          try {
            await deps.onMessage(inbound);
          } catch (error) {
            console.error("WhatsApp inbound message handling failed.", {
              error: error instanceof Error ? error.message : String(error),
              jid: inbound.jid,
            });
          }
        }
      });
    },
    stop() {
      stopped = true;
      generation += 1;
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
