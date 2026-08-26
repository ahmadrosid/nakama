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

export const WHATSAPP_RECONNECT_BASE_MS = 1000;
const WHATSAPP_RECONNECT_MAX_MS = 30_000;

export function whatsappReconnectDelayMs(attempt: number): number {
  const exp = Math.min(Math.max(attempt, 0), 5);
  return Math.min(
    WHATSAPP_RECONNECT_MAX_MS,
    WHATSAPP_RECONNECT_BASE_MS * 2 ** exp
  );
}

export interface WhatsAppSocketDeps {
  createSocket?: typeof makeWASocket;
  delay?: (ms: number) => Promise<void>;
  fetchVersion?: () => ReturnType<typeof fetchLatestBaileysVersion>;
  loadAuthState?: () => ReturnType<typeof usePrivateMultiFileAuthState>;
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
  const { state, saveCreds } = deps.loadAuthState
    ? await deps.loadAuthState()
    : await usePrivateMultiFileAuthState(authDir);
  const { version } = deps.fetchVersion
    ? await deps.fetchVersion()
    : await fetchLatestBaileysVersion();
  const createSocket = deps.createSocket ?? makeWASocket;
  const delay =
    deps.delay ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));

  let socket: WASocket | null = null;
  let stopped = false;
  let starting = false;
  let generation = 0;
  let reconnectAttempt = 0;
  let loggedMissingTextPayload = false;
  const baileysLogger = createBaileysLogger();

  const handle = {
    get socket() {
      return socket;
    },
    async start() {
      if (stopped || starting) {
        return;
      }

      starting = true;
      const myGen = ++generation;

      try {
        const previous = socket;
        socket = null;
        previous?.end(undefined);

        const next = createSocket({
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
            if (myGen !== generation) {
              return;
            }

            generation += 1;
            deps.onDisconnected?.();
            const statusCode = disconnectStatusCode(lastDisconnect);
            const shouldReconnect =
              statusCode !== DisconnectReason.loggedOut && !stopped;

            console.log(
              `WhatsApp disconnected (code: ${statusCode}).${shouldReconnect ? " Reconnecting..." : ""}`
            );

            if (!shouldReconnect) {
              return;
            }

            const waitMs = whatsappReconnectDelayMs(reconnectAttempt);
            reconnectAttempt += 1;
            await delay(waitMs);
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
      } finally {
        starting = false;
      }
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

function disconnectStatusCode(
  lastDisconnect:
    | {
        error?: { message?: string; output?: { statusCode?: number } };
        statusCode?: number;
      }
    | undefined
): number | undefined {
  if (lastDisconnect?.error?.message) {
    return lastDisconnect.error.output?.statusCode;
  }

  return lastDisconnect?.statusCode;
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
