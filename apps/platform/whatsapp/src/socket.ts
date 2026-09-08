import { getWhatsAppConfigDir } from "@nakama/core/whatsapp-config";
import {
  DEFAULT_CONNECTION_CONFIG,
  DisconnectReason,
  extractMessageContent,
  fetchLatestBaileysVersion,
  getContentType,
  jidDecode,
  jidEncode,
  makeWASocket,
  type WASocket,
} from "@whiskeysockets/baileys";
import { usePrivateMultiFileAuthState } from "./auth-state";
import { createBaileysLogger } from "./baileys-logger";
import { isChannelDebugEnabled } from "./channel-log";
import {
  extractInboundText,
  isPrivateWhatsAppChat,
  isWhatsAppOutboundEcho,
  parseInboundWhatsAppMessage,
  rememberWhatsAppOutbound,
  type WhatsAppInboundChat,
} from "./inbound-message";
import { maskWhatsAppJid } from "./log-metadata";

export interface WhatsAppSocketDeps {
  onConnected?: (me: { id: string; lid?: string | null }) => void;
  onDisconnected?: () => void;
  onMessage: (data: WhatsAppInboundChat) => Promise<void>;
  onQr?: (qr: string) => void;
}

export interface WhatsAppSocketHandle {
  socket: WASocket | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
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
      void retireSocket(previous);

      const next = makeWASocket({
        auth: state,
        browser: ["Nakama", "Chrome", "4.0.0"] as [string, string, string],
        connectTimeoutMs: 30_000,
        logger: baileysLogger,
        makeSignalRepository(auth) {
          const repository =
            DEFAULT_CONNECTION_CONFIG.makeSignalRepository(auth);
          const decrypt = repository.decryptMessage.bind(repository);
          const recovered = new Map<string, string>();
          // Baileys 6 looks up PN and LID sessions separately. Only our own
          // credentials provide a trusted identity pair without stanza metadata.
          repository.decryptMessage = async (message) => {
            const sender = jidDecode(message.jid);
            const pn = jidDecode(state.creds.me?.id);
            const lid = jidDecode(state.creds.me?.lid);
            const alternate =
              sender?.server === "lid" && sender.user === lid?.user
                ? pn
                : sender?.server === "s.whatsapp.net" &&
                    sender.user === pn?.user
                  ? lid
                  : undefined;
            if (!(sender && alternate)) {
              return decrypt(message);
            }
            const alternateJid = jidEncode(
              alternate.user,
              alternate.server,
              sender.device
            );
            const primary = recovered.get(message.jid) ?? message.jid;
            try {
              return await decrypt({ ...message, jid: primary });
            } catch (error) {
              if (
                !(error instanceof Error) ||
                (error.name !== "SessionError" && error.message !== "Bad MAC")
              ) {
                throw error;
              }
              const fallback =
                primary === message.jid ? alternateJid : message.jid;
              try {
                const plaintext = await decrypt({ ...message, jid: fallback });
                recovered.set(message.jid, fallback);
                return plaintext;
              } catch {
                throw error;
              }
            }
          };
          return repository;
        },
        markOnlineOnConnect: false,
        printQRInTerminal: false,
        retryRequestDelayMs: 2000,
        // Keep history sync disabled, but allow Baileys init queries so the
        // socket fully subscribes after reconnect/restart.
        shouldSyncHistoryMessage: () => false,
        version,
      });

      if (myGen !== generation || stopped) {
        void retireSocket(next);
        return;
      }

      socket = next;
      wrapSocketSendMessage(next);

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
          // Drop listeners before reconnect so buffered Baileys events on this
          // socket cannot dispatch after the next generation is bound.
          next.ev.removeAllListeners();
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
        if (myGen !== generation || stopped) {
          return;
        }

        if (isChannelDebugEnabled()) {
          console.log(
            `WhatsApp messages.upsert type=${m.type} count=${m.messages.length}`
          );
        }

        if (!isSupportedUpsertType(m.type)) {
          return;
        }

        const me = state.creds.me;

        for (const msg of m.messages) {
          const remoteJid = msg.key.remoteJid ?? null;
          const text = extractInboundText(msg.message);
          // Let the chat handler apply the live mention setting.
          const inbound = parseInboundWhatsAppMessage(msg, me, {
            requireGroupMention: false,
          });

          if (remoteJid && isChannelDebugEnabled()) {
            console.log(
              `WhatsApp upsert item id=${msg.key.id ?? "-"} jid=${maskWhatsAppJid(remoteJid)} fromMe=${msg.key.fromMe ? "yes" : "no"} participant=${maskWhatsAppJid(msg.key.participant)} participantPn=${maskWhatsAppJid(msg.key.participantPn)} textBytes=${Buffer.byteLength(text, "utf8")} handle=${inbound ? "yes" : "no"}`
            );
          }

          if (
            remoteJid &&
            !text &&
            !loggedMissingTextPayload &&
            isPrivateWhatsAppChat(remoteJid)
          ) {
            loggedMissingTextPayload = true;
            if (isChannelDebugEnabled()) {
              console.log(
                "WhatsApp missing-text payload:",
                summarizeMissingTextPayload(msg)
              );
            }
          }

          if (
            !inbound ||
            isWhatsAppOutboundEcho({
              fromMe: inbound.fromMe,
              id: inbound.messageId,
              jid: inbound.jid,
              text: inbound.text,
            })
          ) {
            continue;
          }

          if (myGen !== generation || stopped) {
            return;
          }

          if (isChannelDebugEnabled()) {
            console.log(
              `WhatsApp message received id=${msg.key.id ?? "-"} jid=${maskWhatsAppJid(inbound.jid)} textBytes=${Buffer.byteLength(inbound.text, "utf8")}`
            );
          }

          try {
            await deps.onMessage(inbound);
          } catch (error) {
            console.error("WhatsApp inbound message handling failed.", {
              error: error instanceof Error ? error.message : String(error),
              jid: maskWhatsAppJid(inbound.jid),
              messageId: msg.key.id ?? null,
            });
          }
        }
      });
    },
    async stop() {
      stopped = true;
      generation += 1;
      const current = socket;
      socket = null;
      await retireSocket(current);
    },
  };

  return handle;
}

function wrapSocketSendMessage(target: WASocket): void {
  if (typeof target.sendMessage !== "function") {
    return;
  }

  const sendMessage = target.sendMessage.bind(target);
  target.sendMessage = ((jid, content, options) => {
    const text = outboundTextFromContent(content);
    if (text) {
      rememberWhatsAppOutbound({ jid, text });
    }

    return Promise.resolve(sendMessage(jid, content, options)).then(
      (result) => {
        rememberWhatsAppOutbound({
          id:
            result && typeof result === "object"
              ? ((result as { key?: { id?: string | null } }).key?.id ?? null)
              : null,
          jid,
          text,
        });
        return result;
      }
    );
  }) as WASocket["sendMessage"];
}

function outboundTextFromContent(content: unknown): string {
  if (!content || typeof content !== "object") {
    return "";
  }

  const record = content as { caption?: unknown; text?: unknown };
  if (typeof record.text === "string" && record.text.trim()) {
    return record.text;
  }

  if (typeof record.caption === "string") {
    return record.caption;
  }

  return "";
}

function retireSocket(target: WASocket | null | undefined): Promise<void> {
  if (!target) {
    return Promise.resolve();
  }

  // Strip listeners first so end()'s close emit cannot re-enter reconnect.
  target.ev.removeAllListeners();
  return Promise.resolve(target.end(undefined));
}

function isSupportedUpsertType(type: string): boolean {
  return type === "notify" || type === "append";
}

export function summarizeMissingTextPayload(msg: {
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
  const serializedMessage = JSON.stringify(msg.message ?? null);
  const summary = {
    extractedKeys: extracted ? Object.keys(extracted).slice(0, 10) : [],
    extractedType: getContentType(extracted as any) ?? null,
    key: {
      fromMe: msg.key.fromMe ?? null,
      id: msg.key.id ?? null,
      participant: maskWhatsAppJid(msg.key.participant),
      remoteJid: maskWhatsAppJid(msg.key.remoteJid),
    },
    messageBytes: Buffer.byteLength(serializedMessage, "utf8"),
    messageStubType:
      typeof msg.messageStubType === "number" ? msg.messageStubType : null,
    topLevelKeys: msg.message ? Object.keys(msg.message).slice(0, 10) : [],
    topLevelType: getContentType(msg.message as any) ?? null,
  };

  return JSON.stringify(summary);
}
