import type { TinyClawClient, RemoteChatSession } from "@tinyclaw/client";
import type { SendMessageInput } from "@tinyclaw/core/contract";
import {
  findOrgBySelectionInput,
  formatOrgSelectionPrompt,
  formatOrgSwitchConfirmation,
  prepareChannelOrgContext,
  type ChannelOrgStore,
} from "@tinyclaw/core/channel-org";
import {
  filterProfilesForChatAccess,
  formatProfileSelectionPrompt,
  formatProfileSwitchConfirmation,
  pickProfileForOrg,
  resolveProfileInput,
} from "@tinyclaw/core/profiles";
import type { Context } from "grammy";
import {
  clearActiveStream,
  isAbortError,
  registerActiveStream,
  stopActiveStream,
} from "./active-stream";
import { buildTelegramImageInput } from "./images";
import { normalizeHandshakeInput } from "@tinyclaw/core/telegram-config";
import type { TelegramBridgeConfig } from "./config";
import type { TelegramAuthStore } from "./auth-store";
import { formatError, HELP_TEXT, splitTelegramMessage } from "./format";
import { replyAsChat } from "./reply";
import { TelegramTodoStatusMessage } from "./todo-status-message";
import { createTypingLoop } from "./typing-indicator";
import type { SessionStore } from "./session-store";

const chatLocks = new Map<string, Promise<void>>();

const PAIRING_PROMPT =
  "Welcome to TinyClaw.\n\n" +
  "Paste your pairing code from Integrations → Telegram in the web dashboard. " +
  "You only need to do this once for this chat.";

const NO_CODE_PROMPT =
  "This bot is not linked yet.\n\n" +
  "Open TinyClaw Integrations → Telegram, save your bot token, and copy the pairing code. " +
  "Then send that code here.";

export interface ChatHandlerDeps {
  client: TinyClawClient;
  config: TelegramBridgeConfig;
  authStore: TelegramAuthStore;
  sessionStore: SessionStore;
  orgStore: ChannelOrgStore;
}

export function createChatHandler(deps: ChatHandlerDeps) {
  const { client, config, authStore, sessionStore, orgStore } = deps;

  return async function handleMessage(ctx: Context): Promise<void> {
    if (!ctx.chat || ctx.chat.type !== "private") {
      return;
    }

    const userId = ctx.from?.id;

    if (userId === undefined) {
      return;
    }

    const text = ctx.message?.text?.trim();
    const chatId = String(ctx.chat.id);

    if (text && isStopCommand(text)) {
      if (!stopActiveStream(chatId)) {
        await ctx.reply("Nothing to stop.");
      }

      return;
    }

    await withChatLock(chatId, async () => {
      await authStore.reload();

      if (!authStore.isAuthorized(userId)) {
        if (!text) {
          const imageInput = await tryBuildImageInput(ctx);

          if (imageInput) {
            await ctx.reply("Send your pairing code as text to link this chat.");
            return;
          }

          await ctx.reply("Text messages only.");
          return;
        }

        await handlePairing(ctx, text, userId);
        return;
      }

      const command = text?.startsWith("/") ? parseTelegramCommand(text) : null;
      const bypassOrgGate = command === "/help" || command === "/start" || command === "/org";

      if (!bypassOrgGate) {
        const orgReady = await ensureOrgReady(ctx, userId, text, chatId);
        if (!orgReady) {
          return;
        }
      }

      const imageInput = await tryBuildImageInput(ctx);

      if (imageInput) {
        await handleChatMessage(ctx, imageInput, chatId);
        return;
      }

      if (!text) {
        await ctx.reply(
          "Send text or a photo (with optional caption). Other media is not supported yet.",
        );
        return;
      }

      if (text.startsWith("/")) {
        await handleCommand(ctx, text, chatId);
        return;
      }

      await handleChatMessage(ctx, { message: text }, chatId);
    });
  };

  async function handlePairing(
    ctx: Context,
    text: string,
    userId: number,
  ): Promise<void> {
    const command = parseTelegramCommand(text);
    const fileConfig = authStore.getConfig();
    const hasHandshake = Boolean(fileConfig?.handshakeCode);

    if (command === "/help") {
      await replyChunks(
        ctx,
        `${PAIRING_PROMPT}\n\n${HELP_TEXT}`,
      );
      return;
    }

    if (command === "/start") {
      await ctx.reply(hasHandshake ? PAIRING_PROMPT : NO_CODE_PROMPT);
      return;
    }

    if (!hasHandshake) {
      await ctx.reply(NO_CODE_PROMPT);
      return;
    }

    if (!looksLikeHandshakeAttempt(text)) {
      await ctx.reply(PAIRING_PROMPT);
      return;
    }

    const result = await authStore.tryPair(text, userId);
    await ctx.reply(result.message);
    // Pairing messages stay out of agent session history — only Telegram + config.ini.
  }

  async function handleCommand(ctx: Context, text: string, chatId: string): Promise<void> {
    const command = parseTelegramCommand(text);
    const userId = ctx.from?.id;

    switch (command) {
      case "/start":
      case "/help":
        await replyChunks(ctx, HELP_TEXT);
        return;

      case "/clear": {
        const session = await resolveSession(chatId);
        await session.clear();
        await ctx.reply("History cleared.");
        return;
      }

      case "/compact": {
        const session = await resolveSession(chatId);
        const result = await session.compact({ force: true });
        await ctx.reply(
          `Compacted (${result.action}). Messages: ${result.messagesAfter}.`,
        );
        return;
      }

      case "/new": {
        await createAndBindSession(chatId);
        await ctx.reply("Started a new conversation.");
        return;
      }

      case "/status":
        await replyStatus(ctx, chatId);
        return;

      case "/org":
        if (userId === undefined) {
          return;
        }

        await handleOrgCommand(ctx, text, userId, chatId);
        return;

      case "/profile":
        await handleProfileCommand(ctx, text, chatId);
        return;

      default:
        await ctx.reply(`Unknown command. Try /help`);
    }
  }

  async function tryBuildImageInput(ctx: Context) {
    try {
      return await buildTelegramImageInput(ctx);
    } catch (error) {
      await ctx.reply(formatError(error));
      return null;
    }
  }

  async function handleChatMessage(
    ctx: Context,
    input: SendMessageInput,
    chatId: string,
  ): Promise<void> {
    const session = await resolveSession(chatId);
    const typingLoop = createTypingLoop(ctx);
    const todoStatus = new TelegramTodoStatusMessage(ctx);
    const signal = registerActiveStream(chatId);
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
          await replyAsChat(ctx, reply);
        }

        await ctx.reply("Stopped.");
        return;
      }
    } catch (error) {
      if (isAbortError(error)) {
        await todoStatus.stop();
        if (reply.trim()) {
          await replyAsChat(ctx, reply);
        }

        await ctx.reply("Stopped.");
        return;
      }

      await todoStatus.fail();
      await ctx.reply(formatError(error));
      return;
    } finally {
      clearActiveStream(chatId);
      typingLoop.stop();
    }

    if (reply.trim()) {
      await replyAsChat(ctx, reply);
      return;
    }

    await ctx.reply("(empty reply)");
  }

  async function ensureOrgReady(
    ctx: Context,
    userId: number,
    messageText: string | undefined,
    chatId: string,
  ): Promise<boolean> {
    const channelUserId = String(userId);
    const orgContext = await prepareChannelOrgContext({
      listOrgs: () => client.listUserOrgs(),
      getSelectedOrgId: () => orgStore.get(channelUserId)?.orgId,
      saveSelectedOrgId: async (orgId) => {
        orgStore.set(channelUserId, orgId);
        await orgStore.save();
      },
      text: messageText?.startsWith("/") ? undefined : messageText,
    });

    if (orgContext.status === "empty") {
      await ctx.reply("No organizations are configured yet.");
      return false;
    }

    if (orgContext.status === "prompt") {
      await replyChunks(ctx, orgContext.message);
      return false;
    }

    client.setOrgId(orgContext.orgId);

    if (orgContext.justSelected) {
      await ctx.reply(formatOrgSwitchConfirmation(orgContext.orgName));
      return false;
    }

    return true;
  }

  async function handleOrgCommand(
    ctx: Context,
    text: string,
    userId: number,
    chatId: string,
  ): Promise<void> {
    const channelUserId = String(userId);
    const { orgs } = await client.listUserOrgs();

    if (orgs.length === 0) {
      await ctx.reply("No organizations are configured yet.");
      return;
    }

    const arg = text.trim().split(/\s+/).slice(1).join(" ");
    if (!arg) {
      await replyChunks(
        ctx,
        formatOrgSelectionPrompt(orgs, orgStore.get(channelUserId)?.orgId),
      );
      return;
    }

    const picked = findOrgBySelectionInput(arg, orgs);
    if (!picked) {
      await ctx.reply("Unknown organization. Send /org to see the list.");
      return;
    }

    const previousOrgId = orgStore.get(channelUserId)?.orgId;
    orgStore.set(channelUserId, picked.id);
    await orgStore.save();
    client.setOrgId(picked.id);

    if (previousOrgId && previousOrgId !== picked.id) {
      sessionStore.delete(chatId);
      await sessionStore.save();
    }

    await ctx.reply(formatOrgSwitchConfirmation(picked.name));
  }

  async function handleProfileCommand(
    ctx: Context,
    text: string,
    chatId: string,
  ): Promise<void> {
    const profiles = await listSelectableProfiles();

    if (profiles.length === 0) {
      await ctx.reply("No profiles are available.");
      return;
    }

    const arg = text.trim().split(/\s+/).slice(1).join(" ");
    const currentProfileId = await resolveSessionProfileId(chatId);

    if (!arg) {
      await replyChunks(ctx, formatProfileSelectionPrompt(profiles, currentProfileId));
      return;
    }

    const picked = resolveProfileInput(profiles, arg);
    if (!picked) {
      await ctx.reply("Unknown profile. Send /profile to see the list.");
      return;
    }

    if (picked.id === currentProfileId) {
      await ctx.reply(`Already using ${picked.name}.`);
      return;
    }

    await createAndBindSession(chatId, picked.id);
    await ctx.reply(formatProfileSwitchConfirmation(picked.name));
  }

  async function listSelectableProfiles() {
    const { profiles } = await client.listProfiles();
    return filterProfilesForChatAccess(profiles, { excludeSuperBot: true });
  }

  async function replyStatus(ctx: Context, chatId: string): Promise<void> {
    try {
      const health = await client.health();
      const lines = [
        `Server: ${health.ok ? "ok" : "degraded"}`,
        `Provider configured: ${health.providerConfigured ? "yes" : "no"}`,
      ];

      if (health.providerConfigured) {
        const models = await client.getModels();
        const profiles = await listSelectableProfiles();
        const profileId = await resolveSessionProfileId(chatId);
        const profile = profiles.find((entry) => entry.id === profileId);
        const modelLabel = profile?.model?.includes("::")
          ? profile.model.slice(profile.model.indexOf("::") + 2)
          : profile?.model ?? "none";
        lines.push(`Profile: ${profile?.name ?? profileId}`);
        lines.push(`Provider: ${models.provider ?? "unknown"}`);
        lines.push(`Model: ${modelLabel}`);
      } else {
        lines.push("Chat runs in offline mode without an API key.");
      }

      await replyChunks(ctx, lines.join("\n"));
    } catch (error) {
      await ctx.reply(formatError(error));
    }
  }

  async function resolveSession(chatId: string): Promise<RemoteChatSession> {
    const existing = sessionStore.get(chatId);

    if (existing) {
      const session = client.createChatSession(existing.sessionId, "telegram");

      try {
        await session.getMessages();
        return session;
      } catch {
        // Session missing on server; create a new one below
      }
    }

    return createAndBindSession(chatId);
  }

  async function createAndBindSession(
    chatId: string,
    profileId?: string,
  ): Promise<RemoteChatSession> {
    const resolvedProfileId = profileId ?? (await resolveSessionProfileId(chatId));
    const session = await client.createSession("telegram", {
      profileId: resolvedProfileId,
    });

    sessionStore.set(chatId, {
      sessionId: session.id,
      profileId: resolvedProfileId,
      updatedAt: new Date().toISOString(),
    });
    await sessionStore.save();

    return session;
  }

  async function resolveSessionProfileId(chatId: string): Promise<string> {
    const profiles = await listSelectableProfiles();
    const storedProfileId = sessionStore.get(chatId)?.profileId;

    if (storedProfileId) {
      const match = profiles.find((profile) => profile.id === storedProfileId);

      if (match) {
        return match.id;
      }
    }

    return pickProfileForOrg(profiles, config.profileId).id;
  }
}

async function replyChunks(ctx: Context, text: string): Promise<void> {
  for (const chunk of splitTelegramMessage(text)) {
    await ctx.reply(chunk);
  }
}

function looksLikeHandshakeAttempt(text: string): boolean {
  return /^[0-9A-F]{8}$/.test(normalizeHandshakeInput(text));
}

function parseTelegramCommand(text: string): string {
  const token = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const at = token.indexOf("@");

  return at === -1 ? token : token.slice(0, at);
}

function isStopCommand(text: string): boolean {
  return parseTelegramCommand(text) === "/stop";
}

async function withChatLock(chatId: string, fn: () => Promise<void>): Promise<void> {
  const previous = chatLocks.get(chatId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => current);
  chatLocks.set(chatId, chain);

  try {
    await previous;
    await fn();
  } finally {
    release();
    if (chatLocks.get(chatId) === chain) {
      chatLocks.delete(chatId);
    }
  }
}
