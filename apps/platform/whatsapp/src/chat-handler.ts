import type { TinyClawClient, RemoteChatSession } from "@tinyclaw/client";
import type { SendMessageInput } from "@tinyclaw/core";
import type { WASocket } from "@whiskeysockets/baileys";
import { normalizePairingCode } from "@tinyclaw/core/whatsapp-config";
import {
  clearActiveStream,
  isAbortError,
  registerActiveStream,
  stopActiveStream,
} from "./active-stream";
import type { WhatsAppBridgeConfig } from "./config";
import type { WhatsAppAuthStore } from "./auth-store";
import { formatError, HELP_TEXT, splitWhatsAppMessage, prepareWhatsAppReply } from "./format";
import { createTypingLoop } from "./typing-indicator";
import { WhatsAppTodoStatusMessage } from "./todo-status-message";
import type { SessionStore } from "./session-store";

const chatLocks = new Map<string, Promise<void>>();

const PAIRING_PROMPT =
  "Welcome to TinyClaw.\n\n" +
  "Paste your pairing code from Settings \u2192 WhatsApp in the web dashboard. " +
  "You only need to do this once for this number.";

const NO_CODE_PROMPT =
  "This number is not linked yet.\n\n" +
  "Open TinyClaw Settings \u2192 WhatsApp, generate a pairing code, " +
  "then send that code here. Or scan the QR code in Settings.";

export interface ChatHandlerDeps {
  client: TinyClawClient;
  config: WhatsAppBridgeConfig;
  authStore: WhatsAppAuthStore;
  sessionStore: SessionStore;
  getSocket: () => WASocket | null;
}

export function createChatHandler(deps: ChatHandlerDeps) {
  const { client, config, authStore, sessionStore, getSocket } = deps;

  return async function handleMessage(data: { jid: string; text: string }): Promise<void> {
    const { jid, text } = data;

    if (!text || !text.trim()) {
      return;
    }

    const trimmed = text.trim();

    if (isStopCommand(trimmed)) {
      if (!stopActiveStream(jid)) {
        await sendText(jid, "Nothing to stop.");
      }

      return;
    }

    await withChatLock(jid, async () => {
      await authStore.reload();
      const authorized = authStore.isAuthorized(jid);

      if (!authorized) {
        await handlePairing(jid, trimmed);
        return;
      }

      if (trimmed.startsWith("/")) {
        await handleCommand(jid, trimmed);
        return;
      }

      await handleChatMessage(jid, { message: trimmed });
    });
  };

  async function handlePairing(jid: string, text: string): Promise<void> {
    const command = parseCommand(text);
    const fileConfig = authStore.getConfig();
    const hasPairingCode = Boolean(fileConfig?.pairingCode);

    if (command === "/help") {
      await sendText(jid, `${PAIRING_PROMPT}\n\n${HELP_TEXT}`);
      return;
    }

    if (command === "/start") {
      await sendText(jid, hasPairingCode ? PAIRING_PROMPT : NO_CODE_PROMPT);
      return;
    }

    if (!hasPairingCode) {
      await sendText(jid, NO_CODE_PROMPT);
      return;
    }

    if (!looksLikePairingCodeAttempt(text)) {
      await sendText(jid, PAIRING_PROMPT);
      return;
    }

    const result = await authStore.tryPair(text, jid);
    await sendText(jid, result.message);
  }

  async function handleCommand(jid: string, text: string): Promise<void> {
    const command = parseCommand(text);

    switch (command) {
      case "/start":
      case "/help":
        await sendText(jid, HELP_TEXT);
        return;

      case "/clear": {
        const session = await resolveSession(jid);
        await session.clear();
        await sendText(jid, "History cleared.");
        return;
      }

      case "/compact": {
        const session = await resolveSession(jid);
        const result = await session.compact({ force: true });
        await sendText(
          jid,
          `Compacted (${result.action}). Messages: ${result.messagesAfter}.`,
        );
        return;
      }

      case "/new": {
        await createAndBindSession(jid);
        await sendText(jid, "Started a new conversation.");
        return;
      }

      case "/status":
        await replyStatus(jid);
        return;

      default:
        await sendText(jid, "Unknown command. Try /help");
    }
  }

  async function handleChatMessage(
    jid: string,
    input: SendMessageInput,
  ): Promise<void> {
    const session = await resolveSession(jid);
    const typingLoop = createTypingLoop(getSocket(), jid);
    const todoStatus = new WhatsAppTodoStatusMessage(getSocket(), jid);
    const signal = registerActiveStream(jid);
    let reply = "";

    typingLoop.start();

    try {
      reply = await session.sendStream(
        input,
        {
          onThinking: () => {
            typingLoop.ping();
          },
          onChunk: (delta) => {
            reply += delta;
          },
          onToolStart: () => {
            typingLoop.ping();
          },
          onToolEnd: () => {
            typingLoop.ping();
          },
          onTodosUpdated: (todos) => {
            typingLoop.ping();
            void todoStatus.update(todos);
          },
        },
        { signal },
      );

      await todoStatus.complete();

      if (signal.aborted) {
        if (reply.trim()) {
          await sendText(jid, reply.trim());
        }

        await sendText(jid, "Stopped.");
        return;
      }
    } catch (error) {
      if (isAbortError(error)) {
        await todoStatus.stop();
        if (reply.trim()) {
          await sendText(jid, reply.trim());
        }

        await sendText(jid, "Stopped.");
        return;
      }

      await todoStatus.fail();
      await sendText(jid, formatError(error));
      return;
    } finally {
      clearActiveStream(jid);
      typingLoop.stop();
    }

    if (reply.trim()) {
      await sendText(jid, reply.trim());
      return;
    }

    await sendText(jid, "(empty reply)");
  }

  async function replyStatus(jid: string): Promise<void> {
    try {
      const health = await client.health();
      const lines = [
        `Server: ${health.ok ? "ok" : "degraded"}`,
        `Provider configured: ${health.providerConfigured ? "yes" : "no"}`,
      ];

      if (health.providerConfigured) {
        const models = await client.getModels();
        const profileId = await resolveProfileId();
        const profiles = await client.listProfiles();
        const profile = profiles.profiles.find((entry) => entry.id === profileId);
        const modelLabel = profile?.model?.includes("::")
          ? profile.model.slice(profile.model.indexOf("::") + 2)
          : profile?.model ?? "none";
        lines.push(`Provider: ${models.provider ?? "unknown"}`);
        lines.push(`Model: ${modelLabel}`);
      } else {
        lines.push("Chat runs in offline mode without an API key.");
      }

      await sendText(jid, lines.join("\n"));
    } catch (error) {
      await sendText(jid, formatError(error));
    }
  }

  async function resolveProfileId(): Promise<string> {
    const fileConfig = authStore.getConfig();
    const preferredProfileId = fileConfig?.profileId?.trim() || config.profileId;
    const profiles = await client.listProfiles();
    const profileIds = new Set(profiles.profiles.map((profile) => profile.id));

    if (profileIds.has(preferredProfileId)) {
      return preferredProfileId;
    }

    if (profileIds.has("default")) {
      return "default";
    }

    const fallback = profiles.profiles[0]?.id;
    if (fallback) {
      return fallback;
    }

    throw new Error("No profiles exist on the server. Create a profile in the web dashboard first.");
  }

  async function resolveSession(jid: string): Promise<RemoteChatSession> {
    const profileId = await resolveProfileId();
    const existing = sessionStore.get(jid);

    if (existing && existing.profileId === profileId) {
      const session = client.createChatSession(existing.sessionId, "whatsapp");

      try {
        await session.getMessages();
        return session;
      } catch {
        // Session missing on server; create a new one below
      }
    }

    return createAndBindSession(jid, profileId);
  }

  async function createAndBindSession(
    jid: string,
    profileId?: string,
  ): Promise<RemoteChatSession> {
    const resolvedProfileId = profileId ?? (await resolveProfileId());
    const session = await client.createSession("whatsapp", {
      profileId: resolvedProfileId,
    });

    sessionStore.set(jid, {
      sessionId: session.id,
      profileId: resolvedProfileId,
      updatedAt: new Date().toISOString(),
    });
    await sessionStore.save();

    return session;
  }

  async function sendText(jid: string, text: string): Promise<void> {
    const socket = getSocket();
    if (!socket) {
      return;
    }

    const prepared = prepareWhatsAppReply(text);
    if (!prepared) {
      return;
    }

    for (const chunk of splitWhatsAppMessage(prepared)) {
      await socket.sendMessage(jid, { text: chunk });
    }
  }
}

function parseCommand(text: string): string {
  const token = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return token;
}

function isStopCommand(text: string): boolean {
  return parseCommand(text) === "/stop";
}

function looksLikePairingCodeAttempt(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed || /\s/.test(trimmed) || trimmed.startsWith("/")) {
    return false;
  }

  if (/^[0-9A-F]{8}$/.test(normalizePairingCode(trimmed))) {
    return true;
  }

  return trimmed === trimmed.toUpperCase() && /^[A-Z0-9-]{4,12}$/.test(trimmed);
}

async function withChatLock(jid: string, fn: () => Promise<void>): Promise<void> {
  const previous = chatLocks.get(jid) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => current);
  chatLocks.set(jid, chain);

  try {
    await previous;
    await fn();
  } finally {
    release();
    if (chatLocks.get(jid) === chain) {
      chatLocks.delete(jid);
    }
  }
}
