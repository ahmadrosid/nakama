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
  isProfileSelectionIndexInput,
  pickProfileForOrg,
  resolveProfileInput,
  resolveProfileInScopes,
  type ProfileScope,
} from "@tinyclaw/core/profiles";
import type { Context } from "grammy";
import {
  clearActiveStream,
  isAbortError,
  registerActiveStream,
  stopActiveStream,
} from "./active-stream";
import {
  buildTelegramDocumentInput,
  DOWNLOAD_FAILED_REPLY,
  hasTelegramDocument,
  UNSUPPORTED_MEDIA_REPLY,
} from "./attachments";
import { buildTelegramImageInput } from "./images";
import {
  buildTelegramAudioInput,
  formatTelegramAudioError,
  hasTelegramAudio,
} from "./audio";
import { normalizeHandshakeInput } from "@tinyclaw/core/telegram-config";
import type { TelegramBridgeConfig } from "./config";
import type { TelegramAuthStore } from "./auth-store";
import { formatError, HELP_TEXT, splitTelegramMessage } from "./format";
import { replyAsChat } from "./reply";
import { TelegramTodoStatusMessage } from "./todo-status-message";
import { createTelegramRichMessenger, type TelegramRichMessenger } from "./rich-message";
import { createTypingLoop } from "./typing-indicator";
import type { SessionStore } from "./session-store";
import {
  explainGroupMessageHandling,
  isTelegramGroupChat,
  resolveChannelOrgKey,
  resolveBotInfo,
  stripBotMention,
  type TelegramBotInfo,
} from "./group-message";

const chatLocks = new Map<string, Promise<void>>();

const GROUP_MESSAGE_PREFIX =
  "[Telegram group — your reply is visible to everyone in this group.]\n";

const LINK_IN_PRIVATE_REPLY =
  "Link your account in a private chat with this bot first.";

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
  getBotInfo?: () => TelegramBotInfo | undefined;
}

export function createChatHandler(deps: ChatHandlerDeps) {
  const { client, config, authStore, sessionStore, orgStore, getBotInfo = () => undefined } =
    deps;

  return async function handleMessage(ctx: Context): Promise<void> {
    if (!ctx.chat) {
      return;
    }

    const telegram = createTelegramRichMessenger(ctx);
    const chatId = String(ctx.chat.id);
    const userId = ctx.from?.id;

    if (userId === undefined) {
      return;
    }

    const text = ctx.message?.text?.trim();
    const isGroup = isTelegramGroupChat(ctx);
    const botInfo = resolveBotInfo(ctx, getBotInfo());
    const groupDecision = isGroup ? explainGroupMessageHandling(ctx, botInfo) : null;

    if (groupDecision && !groupDecision.shouldHandle) {
      console.log(
        [
          "Ignored Telegram group message",
          `reason=${groupDecision.reason}`,
          `bot=@${botInfo?.username ?? "unknown"}`,
          `botId=${botInfo?.id ?? "unknown"}`,
          `text=${JSON.stringify(text ?? "")}`,
        ].join(" "),
      );
      return;
    }

    const channelOrgKey = resolveChannelOrgKey(chatId, userId, isGroup);

    if (text && isStopCommand(text)) {
      if (!stopActiveStream(chatId)) {
        await telegram.send("Nothing to stop.");
      }

      return;
    }

    await withChatLock(chatId, async () => {
      await authStore.reload();
      const isAuthorized = authStore.isAuthorized(userId);

      if (!isAuthorized) {
        if (isGroup) {
          await telegram.send(LINK_IN_PRIVATE_REPLY);
          return;
        }

        if (!text) {
          const imageInput = await tryBuildImageInput(ctx, telegram);

          if (imageInput) {
            await telegram.send("Send your pairing code as text to link this chat.");
            return;
          }

          if (hasTelegramDocument(ctx) || hasTelegramAudio(ctx)) {
            await telegram.send("Send your pairing code as text to link this chat.");
            return;
          }

          await telegram.send("Text messages only.");
          return;
        }

        await handlePairing(ctx, text, userId, telegram);
        return;
      }

      if (isGroup && text && looksLikeHandshakeAttempt(text)) {
        await telegram.send(LINK_IN_PRIVATE_REPLY);
        return;
      }

      const command = text?.startsWith("/") ? parseTelegramCommand(text) : null;
      const bypassOrgGate = command === "/help" || command === "/start" || command === "/org";

      if (!bypassOrgGate) {
        const orgGateText =
          isGroup && text && botInfo?.username
            ? stripBotMention(text, botInfo.username)
            : text;
        const orgReady = await ensureOrgReady(telegram, channelOrgKey, orgGateText);
        if (!orgReady) {
          return;
        }
      }

      const imageInput = await tryBuildImageInput(ctx, telegram);

      if (imageInput) {
        await handleChatMessage(ctx, withGroupContext(imageInput, isGroup), chatId, telegram);
        return;
      }

      const documentInput = await tryBuildDocumentInput(ctx, telegram);

      if (documentInput) {
        await handleChatMessage(ctx, withGroupContext(documentInput, isGroup), chatId, telegram);
        return;
      }

      const audioInput = await tryBuildAudioInput(ctx, telegram);

      if (audioInput) {
        await handleChatMessage(ctx, withGroupContext(audioInput, isGroup), chatId, telegram);
        return;
      }

      if (hasTelegramDocument(ctx)) {
        return;
      }

      if (!text) {
        await telegram.send(UNSUPPORTED_MEDIA_REPLY);
        return;
      }

      if (text.startsWith("/")) {
        await handleCommand(ctx, text, chatId, channelOrgKey, telegram);
        return;
      }

      const messageText =
        isGroup ? stripBotMention(text, botInfo?.username) : text;

      await handleChatMessage(
        ctx,
        withGroupContext({ message: messageText }, isGroup),
        chatId,
        telegram,
      );
    });
  };

  async function handlePairing(
    ctx: Context,
    text: string,
    userId: number,
    telegram: TelegramRichMessenger,
  ): Promise<void> {
    const command = parseTelegramCommand(text);
    const fileConfig = authStore.getConfig();
    const hasHandshake = Boolean(fileConfig?.handshakeCode);

    if (command === "/help") {
      await replyChunks(telegram, `${PAIRING_PROMPT}\n\n${HELP_TEXT}`);
      return;
    }

    if (command === "/start") {
      await telegram.send(hasHandshake ? PAIRING_PROMPT : NO_CODE_PROMPT);
      return;
    }

    if (!hasHandshake) {
      await telegram.send(NO_CODE_PROMPT);
      return;
    }

    if (!looksLikeHandshakeAttempt(text)) {
      await telegram.send(PAIRING_PROMPT);
      return;
    }

    const result = await authStore.tryPair(text, userId);
    await telegram.send(result.message);
    // Pairing messages stay out of agent session history — only Telegram + config.ini.
  }

  async function handleCommand(
    ctx: Context,
    text: string,
    chatId: string,
    channelOrgKey: string,
    telegram: TelegramRichMessenger,
  ): Promise<void> {
    const command = parseTelegramCommand(text);

    switch (command) {
      case "/start":
      case "/help":
        await replyChunks(telegram, HELP_TEXT);
        return;

      case "/clear": {
        const session = await resolveSession(chatId);
        await session.clear();
        await telegram.send("History cleared.");
        return;
      }

      case "/compact": {
        const session = await resolveSession(chatId);
        const result = await session.compact({ force: true });
        await telegram.send(`Compacted (${result.action}). Messages: ${result.messagesAfter}.`);
        return;
      }

      case "/new": {
        await createAndBindSession(chatId);
        await telegram.send("Started a new conversation.");
        return;
      }

      case "/status":
        await replyStatus(telegram, chatId);
        return;

      case "/org":
        await handleOrgCommand(text, channelOrgKey, chatId, telegram);
        return;

      case "/profile":
        await handleProfileCommand(text, chatId, channelOrgKey, telegram);
        return;

      default:
        await telegram.send(`Unknown command. Try /help`);
    }
  }

  async function tryBuildImageInput(
    ctx: Context,
    telegram: TelegramRichMessenger,
  ): Promise<SendMessageInput | null> {
    try {
      return await buildTelegramImageInput(ctx);
    } catch (error) {
      await telegram.send(formatError(error));
      return null;
    }
  }

  async function tryBuildDocumentInput(
    ctx: Context,
    telegram: TelegramRichMessenger,
  ): Promise<SendMessageInput | null> {
    try {
      const result = await buildTelegramDocumentInput(ctx);

      if (!result) {
        return null;
      }

      if (result.kind === "reject") {
        await telegram.send(result.message);
        return null;
      }

      return result.input;
    } catch {
      await telegram.send(DOWNLOAD_FAILED_REPLY);
      return null;
    }
  }

  async function tryBuildAudioInput(
    ctx: Context,
    telegram: TelegramRichMessenger,
  ): Promise<SendMessageInput | null> {
    if (!hasTelegramAudio(ctx)) {
      return null;
    }

    try {
      return await buildTelegramAudioInput(ctx, client);
    } catch (error) {
      await telegram.send(formatTelegramAudioError(error));
      return null;
    }
  }

  async function handleChatMessage(
    ctx: Context,
    input: SendMessageInput,
    chatId: string,
    telegram: TelegramRichMessenger,
  ): Promise<void> {
    const session = await resolveSession(chatId);
    const typingLoop = createTypingLoop(ctx);
    const todoStatus = new TelegramTodoStatusMessage(telegram);
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
          await replyAsChat(telegram, reply);
        }

        await telegram.send("Stopped.");
        return;
      }
    } catch (error) {
      if (isAbortError(error)) {
        await todoStatus.stop();
        if (reply.trim()) {
          await replyAsChat(telegram, reply);
        }

        await telegram.send("Stopped.");
        return;
      }

      await todoStatus.fail();
      await telegram.send(formatError(error));
      return;
    } finally {
      clearActiveStream(chatId);
      typingLoop.stop();
    }

    if (reply.trim()) {
      await replyAsChat(telegram, reply);
      return;
    }

    await telegram.send("(empty reply)");
  }

  async function ensureOrgReady(
    telegram: TelegramRichMessenger,
    channelOrgKey: string,
    messageText: string | undefined,
  ): Promise<boolean> {
    const orgContext = await prepareChannelOrgContext({
      listOrgs: () => client.listUserOrgs(),
      getSelectedOrgId: () => getOrgSelection(orgStore, channelOrgKey)?.orgId,
      saveSelectedOrgId: async (orgId) => {
        orgStore.set(channelOrgKey, orgId);
        await orgStore.save();
      },
      text: messageText?.startsWith("/") ? undefined : messageText,
    });

    if (orgContext.status === "empty") {
      await telegram.send("No organizations are configured yet.");
      return false;
    }

    if (orgContext.status === "prompt") {
      await replyChunks(telegram, orgContext.message);
      return false;
    }

    client.setOrgId(orgContext.orgId);

    if (orgContext.justSelected) {
      await telegram.send(formatOrgSwitchConfirmation(orgContext.orgName));
      return false;
    }

    return true;
  }

  async function handleOrgCommand(
    text: string,
    channelOrgKey: string,
    chatId: string,
    telegram: TelegramRichMessenger,
  ): Promise<void> {
    const { orgs } = await client.listUserOrgs();

    if (orgs.length === 0) {
      await telegram.send("No organizations are configured yet.");
      return;
    }

    const arg = text.trim().split(/\s+/).slice(1).join(" ");
    if (!arg) {
      await replyChunks(
        telegram,
        formatOrgSelectionPrompt(orgs, getOrgSelection(orgStore, channelOrgKey)?.orgId),
      );
      return;
    }

    const picked = findOrgBySelectionInput(arg, orgs);
    if (!picked) {
      await telegram.send("Unknown organization. Send /org to see the list.");
      return;
    }

    const previousOrgId = getOrgSelection(orgStore, channelOrgKey)?.orgId;
    orgStore.set(channelOrgKey, picked.id);
    await orgStore.save();
    client.setOrgId(picked.id);

    if (previousOrgId && previousOrgId !== picked.id) {
      sessionStore.delete(chatId);
      await sessionStore.save();
    }

    await telegram.send(formatOrgSwitchConfirmation(picked.name));
  }

  async function handleProfileCommand(
    text: string,
    chatId: string,
    channelOrgKey: string,
    telegram: TelegramRichMessenger,
  ): Promise<void> {
    const { orgs } = await client.listUserOrgs();
    const currentOrgId = getOrgSelection(orgStore, channelOrgKey)?.orgId;
    const currentOrg = currentOrgId ? orgs.find((org) => org.id === currentOrgId) : undefined;
    const arg = text.trim().split(/\s+/).slice(1).join(" ");
    const currentProfileId = await resolveSessionProfileId(chatId);

    if (!arg) {
      const profiles = await listSelectableProfiles();

      if (profiles.length === 0) {
        await telegram.send("No profiles are available.");
        return;
      }

      await replyChunks(
        telegram,
        formatProfileSelectionPrompt(profiles, currentProfileId, currentOrg?.name),
      );
      return;
    }

    const currentOrgProfiles = currentOrgId ? await listSelectableProfiles() : [];
    const currentOrgNumericPick =
      currentOrgId && isProfileSelectionIndexInput(arg, currentOrgProfiles.length)
        ? resolveProfileInput(currentOrgProfiles, arg)
        : undefined;
    const resolved =
      currentOrgId && currentOrgNumericPick
        ? {
            scope: {
              orgId: currentOrgId,
              orgName: currentOrg?.name ?? "Current org",
              profiles: currentOrgProfiles,
            },
            profile: currentOrgNumericPick,
          }
        : resolveProfileInScopes(await listProfileScopes(orgs, currentOrgId), arg);

    if (!resolved) {
      await telegram.send("Unknown profile. Send /profile to see the list.");
      return;
    }

    if ("ambiguous" in resolved) {
      await telegram.send(
        `That profile exists in multiple orgs (${resolved.ambiguous}). Send /org first, then /profile.`,
      );
      return;
    }

    const { scope, profile: picked } = resolved;

    if (scope.orgId !== currentOrgId) {
      orgStore.set(channelOrgKey, scope.orgId);
      await orgStore.save();
      client.setOrgId(scope.orgId);
      sessionStore.delete(chatId);
      await sessionStore.save();
    }

    if (picked.id === currentProfileId && scope.orgId === currentOrgId) {
      await telegram.send(`Already using ${picked.name}.`);
      return;
    }

    await createAndBindSession(chatId, picked.id);
    const orgNote = scope.orgId !== currentOrgId ? ` (${scope.orgName})` : "";
    await telegram.send(`${formatProfileSwitchConfirmation(picked.name)}${orgNote}`);
  }

  async function listProfileScopes(
    orgs: Array<{ id: string; name: string }>,
    restoreOrgId?: string,
  ): Promise<ProfileScope[]> {
    const scopes: ProfileScope[] = [];

    for (const org of orgs) {
      client.setOrgId(org.id);
      const profiles = await listSelectableProfiles();

      if (profiles.length > 0) {
        scopes.push({ orgId: org.id, orgName: org.name, profiles });
      }
    }

    if (restoreOrgId) {
      client.setOrgId(restoreOrgId);
    }

    return scopes;
  }

  async function listSelectableProfiles() {
    const { profiles } = await client.listProfiles();
    return filterProfilesForChatAccess(profiles, { excludeSuperBot: true });
  }

  async function replyStatus(telegram: TelegramRichMessenger, chatId: string): Promise<void> {
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

      await replyChunks(telegram, lines.join("\n"));
    } catch (error) {
      await telegram.send(formatError(error));
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

function withGroupContext(input: SendMessageInput, isGroup: boolean): SendMessageInput {
  if (!isGroup) {
    return input;
  }

  const message = input.message?.trim();

  if (message) {
    return { ...input, message: `${GROUP_MESSAGE_PREFIX}${message}` };
  }

  return { ...input, message: GROUP_MESSAGE_PREFIX.trim() };
}

function getOrgSelection(
  orgStore: ChannelOrgStore,
  channelOrgKey: string,
): ReturnType<ChannelOrgStore["get"]> {
  const selected = orgStore.get(channelOrgKey);

  if (selected) {
    return selected;
  }

  // ponytail: legacy private keys were bare user ids before group support
  if (channelOrgKey.startsWith("u:")) {
    return orgStore.get(channelOrgKey.slice(2));
  }

  return undefined;
}

async function replyChunks(
  telegram: TelegramRichMessenger,
  text: string,
): Promise<void> {
  for (const chunk of splitTelegramMessage(text)) {
    await telegram.send(chunk);
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
