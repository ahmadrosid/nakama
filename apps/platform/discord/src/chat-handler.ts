import type { NakamaClient, RemoteChatSession } from "@nakama/client";
import type { SendMessageInput } from "@nakama/core/contract";
import {
  findOrgBySelectionInput,
  formatOrgSelectionPrompt,
  formatOrgSwitchConfirmation,
  prepareChannelOrgContext,
  type ChannelOrgStore,
} from "@nakama/core/channel-org";
import {
  filterProfilesForChatAccess,
  formatProfileSelectionPrompt,
  formatProfileSwitchConfirmation,
  isProfileSelectionIndexInput,
  pickProfileForOrg,
  resolveProfileInput,
  resolveProfileInScopes,
  type ProfileScope,
} from "@nakama/core/profiles";
import type { ChatInputCommandInteraction, Message, TextBasedChannel } from "discord.js";
import {
  clearActiveStream,
  isAbortError,
  registerActiveStream,
  stopActiveStream,
} from "./active-stream";
import type { DiscordAuthStore } from "./auth-store";
import type { DiscordBridgeConfig } from "./config";
import { formatError, HELP_TEXT, splitDiscordMessage } from "./format";
import { isIgnorableInteractionError } from "./interaction-errors";
import {
  explainGuildMessageHandling,
  isDiscordGuildMessage,
  isDiscordThreadMessage,
  looksLikeHandshakeAttempt,
  parseTextCommand,
  resolveBotInfo,
  resolveChannelOrgKey,
  resolveConversationKey,
  stripBotMention,
  type DiscordBotInfo,
} from "./guild-message";
import {
  createDiscordMessenger,
  createInteractionMessenger,
  getMessageChannel,
  replyAsChat,
  type DiscordMessenger,
} from "./messenger";
import {
  deliverDiscordTurnArtifactShares,
  maybeSendRequestedDiscordArtifactAttachment,
} from "./channel-artifact-flow";
import type { SessionStore } from "./session-store";
import { DiscordTodoStatusMessage } from "./todo-status-message";
import { createTypingLoop } from "./typing-indicator";

const chatLocks = new Map<string, Promise<void>>();

const GROUP_MESSAGE_PREFIX =
  "[Discord channel — your reply is visible to everyone in this channel.]\n";

const LINK_IN_PRIVATE_REPLY =
  "Link your account in a private DM with this bot first.";

const PAIRING_PROMPT =
  "Welcome to Nakama.\n\n" +
  "Paste your pairing code from Integrations → Discord in the web dashboard. " +
  "You only need to do this once.";

const NO_CODE_PROMPT =
  "This bot is not linked yet.\n\n" +
  "Open Nakama Integrations → Discord, save your bot token, and copy the pairing code. " +
  "Then send that code here in a DM.";

export interface ChatHandlerDeps {
  client: NakamaClient;
  config: DiscordBridgeConfig;
  authStore: DiscordAuthStore;
  sessionStore: SessionStore;
  orgStore: ChannelOrgStore;
  getBotInfo?: () => DiscordBotInfo | undefined;
}

export function createChatHandler(deps: ChatHandlerDeps) {
  const { client, config, authStore, sessionStore, orgStore, getBotInfo = () => undefined } =
    deps;

  return {
    handleMessage,
    handleSlashCommand,
  };

  async function handleMessage(message: Message): Promise<void> {
    if (message.author.bot) {
      return;
    }

    const channel = getMessageChannel(message);
    const messenger = createDiscordMessenger(channel);
    const userId = message.author.id;
    const channelId = message.channel.id;
    const text = message.content?.trim();
    const isGuild = isDiscordGuildMessage(message);
    const botInfo = resolveBotInfo(message, getBotInfo());
    const groupDecision = isGuild ? explainGuildMessageHandling(message, botInfo) : null;

    if (groupDecision && !groupDecision.shouldHandle) {
      return;
    }

    const channelOrgKey = resolveChannelOrgKey(channelId, userId, isGuild);
    const conversationKey = resolveConversationKey(message, channelId, isGuild);
    const isThread = isDiscordThreadMessage(message);

    await withChatLock(conversationKey, async () => {
      await authStore.reload();
      const isAuthorized = authStore.isAuthorized(userId);

      if (!isAuthorized) {
        if (isGuild) {
          await messenger.send(LINK_IN_PRIVATE_REPLY);
          return;
        }

        if (!text) {
          await messenger.send("Send your pairing code as text to link this chat.");
          return;
        }

        await handlePairing(text, userId, messenger);
        return;
      }

      if (isGuild && text && looksLikeHandshakeAttempt(text)) {
        await messenger.send(LINK_IN_PRIVATE_REPLY);
        return;
      }

      const command = text?.startsWith("/") ? parseTextCommand(text) : null;
      const bypassOrgGate = command === "/help" || command === "/start" || command === "/org";

      if (!bypassOrgGate) {
        const orgGateText =
          isGuild && text && botInfo ? stripBotMention(text, botInfo) : text;
        const orgReady = await ensureOrgReady(messenger, channelOrgKey, orgGateText);
        if (!orgReady) {
          return;
        }
      }

      if (!text) {
        await messenger.send("Text messages only.");
        return;
      }

      if (command === "/org" || command === "/profile") {
        await handleTextCommand(text, command, conversationKey, channelOrgKey, isThread, messenger);
        return;
      }

      if (text.startsWith("/")) {
        await messenger.send("Use slash commands from Discord's command menu for session control.");
        return;
      }

      const messageText = isGuild && botInfo ? stripBotMention(text, botInfo) : text;

      if (!messageText) {
        return;
      }

      await handleChatMessage(
        channel,
        withGroupContext({ message: messageText }, isGuild),
        conversationKey,
        messenger,
        messageText,
      );
    });
  }

  async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    // Caller (bot.ts) already deferred — do not wait on withChatLock here.
    // Agent replies hold that lock for a long time and would leave commands stuck.

    const userId = interaction.user.id;
    const channelId = interaction.channelId;
    const isGuild = !interaction.channel?.isDMBased();
    const channelOrgKey = resolveChannelOrgKey(channelId, userId, isGuild);
    const conversationKey = isGuild
      ? interaction.channel?.isThread()
        ? `g:${interaction.channel.parentId ?? channelId}:t:${interaction.channel.id}`
        : channelId
      : channelId;

    const messenger = createInteractionMessenger(
      (content) => interaction.reply({ content: content.slice(0, 2000) }),
      (content) => interaction.followUp({ content: content.slice(0, 2000) }),
      (content) => interaction.editReply({ content: content.slice(0, 2000) }),
      true,
    );

    try {
      await authStore.reload();

      if (!authStore.isAuthorized(userId)) {
        if (interaction.commandName === "start" || interaction.commandName === "help") {
          await handlePairingSlash(interaction.commandName, messenger);
          return;
        }

        await messenger.send(
          interaction.channel?.isDMBased() ? PAIRING_PROMPT : LINK_IN_PRIVATE_REPLY,
        );
        return;
      }

      if (interaction.commandName === "start" || interaction.commandName === "help") {
        await messenger.send(HELP_TEXT);
        return;
      }

      if (interaction.commandName === "stop") {
        if (!stopActiveStream(conversationKey)) {
          await messenger.send("Nothing to stop.");
        } else {
          await messenger.send("Stopping…");
        }
        return;
      }

      const orgReady = await ensureOrgReady(messenger, channelOrgKey, undefined);
      if (!orgReady) {
        return;
      }

      switch (interaction.commandName) {
        case "clear": {
          stopActiveStream(conversationKey);
          const session = await resolveSession(conversationKey);
          await session.clear();
          clearSessionArtifactState(conversationKey);
          await messenger.send("History cleared.");
          return;
        }
        case "compact": {
          stopActiveStream(conversationKey);
          const session = await resolveSession(conversationKey);
          const result = await session.compact({ force: true });
          await messenger.send(
            `Compacted (${result.action}). Messages: ${result.messagesAfter}.`,
          );
          return;
        }
        case "new": {
          stopActiveStream(conversationKey);
          await createAndBindSession(conversationKey);
          await messenger.send("Started a new conversation.");
          return;
        }
        case "status":
          await replyStatus(messenger, conversationKey);
          return;
        default:
          await messenger.send("Unknown command. Try /help");
      }
    } catch (error) {
      // Finalize the deferred reply so Discord does not stay on "thinking…".
      if (isIgnorableInteractionError(error)) {
        console.warn("Slash command interaction expired before reply could be sent.");
        return;
      }

      console.error("Slash command error:", error);
      await messenger.send(formatError(error)).catch(() => {});
    }
  }

  async function handlePairing(
    text: string,
    userId: string,
    messenger: DiscordMessenger,
  ): Promise<void> {
    const command = parseTextCommand(text);
    const fileConfig = authStore.getConfig();
    const hasHandshake = Boolean(fileConfig?.handshakeCode);

    if (command === "/help") {
      await replyChunks(messenger, `${PAIRING_PROMPT}\n\n${HELP_TEXT}`);
      return;
    }

    if (command === "/start") {
      await messenger.send(hasHandshake ? PAIRING_PROMPT : NO_CODE_PROMPT);
      return;
    }

    if (!hasHandshake) {
      await messenger.send(NO_CODE_PROMPT);
      return;
    }

    if (!looksLikeHandshakeAttempt(text)) {
      await messenger.send(PAIRING_PROMPT);
      return;
    }

    const result = await authStore.tryPair(text, userId);
    await messenger.send(result.message);
  }

  async function handlePairingSlash(
    command: string,
    messenger: DiscordMessenger,
  ): Promise<void> {
    const hasHandshake = Boolean(authStore.getConfig()?.handshakeCode);

    if (command === "help") {
      await replyChunks(messenger, `${PAIRING_PROMPT}\n\n${HELP_TEXT}`);
      return;
    }

    await messenger.send(hasHandshake ? PAIRING_PROMPT : NO_CODE_PROMPT);
  }

  async function handleTextCommand(
    text: string,
    command: string,
    conversationKey: string,
    channelOrgKey: string,
    isThread: boolean,
    messenger: DiscordMessenger,
  ): Promise<void> {
    if (command === "/org") {
      await handleOrgCommand(text, channelOrgKey, conversationKey, messenger);
      return;
    }

    if (command === "/profile") {
      await handleProfileCommand(text, conversationKey, channelOrgKey, isThread, messenger);
      return;
    }
  }

  async function handleChatMessage(
    channel: TextBasedChannel,
    input: SendMessageInput,
    conversationKey: string,
    messenger: DiscordMessenger,
    attachUserText: string,
  ): Promise<void> {
    const session = await resolveSession(conversationKey);
    const profileId = sessionStore.get(conversationKey)?.profileId;

    if (profileId) {
      await maybeSendRequestedDiscordArtifactAttachment({
        channel,
        client,
        conversationKey,
        profileId,
        attachUserText,
        sessionStore,
        messenger,
      });
    }

    const signal = registerActiveStream(conversationKey);
    const typingLoop = createTypingLoop(messenger);
    const todoStatus = new DiscordTodoStatusMessage(messenger);
    typingLoop.start();

    let reply = "";

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
          await replyAsChat(messenger, reply);
        }

        await messenger.send("Stopped.");
        return;
      }
    } catch (error) {
      if (isAbortError(error)) {
        await todoStatus.stop();
        if (reply.trim()) {
          await replyAsChat(messenger, reply);
        }

        await messenger.send("Stopped.");
        return;
      }

      await todoStatus.fail();
      await messenger.send(formatError(error));
      return;
    } finally {
      clearActiveStream(conversationKey);
      typingLoop.stop();
    }

    if (reply.trim()) {
      await replyAsChat(messenger, reply);
    } else {
      await messenger.send("(empty reply)");
    }

    if (profileId) {
      await deliverDiscordTurnArtifactShares({
        client,
        session,
        conversationKey,
        profileId,
        sessionStore,
        messenger,
      });
    }
  }

  async function ensureOrgReady(
    messenger: DiscordMessenger,
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
      await messenger.send("No organizations are configured yet.");
      return false;
    }

    if (orgContext.status === "prompt") {
      await replyChunks(messenger, orgContext.message);
      return false;
    }

    client.setOrgId(orgContext.orgId);

    if (orgContext.justSelected) {
      await messenger.send(formatOrgSwitchConfirmation(orgContext.orgName));
      return false;
    }

    return true;
  }

  async function handleOrgCommand(
    text: string,
    channelOrgKey: string,
    conversationKey: string,
    messenger: DiscordMessenger,
  ): Promise<void> {
    const { orgs } = await client.listUserOrgs();

    if (orgs.length === 0) {
      await messenger.send("No organizations are configured yet.");
      return;
    }

    const arg = text.trim().split(/\s+/).slice(1).join(" ");

    if (!arg) {
      await replyChunks(
        messenger,
        formatOrgSelectionPrompt(orgs, getOrgSelection(orgStore, channelOrgKey)?.orgId),
      );
      return;
    }

    const picked = findOrgBySelectionInput(arg, orgs);

    if (!picked) {
      await messenger.send("Unknown organization. Send /org to see the list.");
      return;
    }

    const previousOrgId = getOrgSelection(orgStore, channelOrgKey)?.orgId;
    orgStore.set(channelOrgKey, picked.id);
    await orgStore.save();
    client.setOrgId(picked.id);

    if (previousOrgId && previousOrgId !== picked.id) {
      sessionStore.delete(conversationKey);
      await sessionStore.save();
    }

    await messenger.send(formatOrgSwitchConfirmation(picked.name));
  }

  async function handleProfileCommand(
    text: string,
    conversationKey: string,
    channelOrgKey: string,
    isThread: boolean,
    messenger: DiscordMessenger,
  ): Promise<void> {
    const { orgs } = await client.listUserOrgs();
    const currentOrgId = getOrgSelection(orgStore, channelOrgKey)?.orgId;
    const currentOrg = currentOrgId ? orgs.find((org) => org.id === currentOrgId) : undefined;
    const arg = text.trim().split(/\s+/).slice(1).join(" ");
    const currentProfileId = await resolveSessionProfileId(conversationKey);

    if (!arg) {
      const profiles = await listSelectableProfiles();

      if (profiles.length === 0) {
        await messenger.send("No profiles are available.");
        return;
      }

      await replyChunks(
        messenger,
        formatProfileSelectionPrompt(profiles, currentProfileId, currentOrg?.name),
      );
      return;
    }

    const currentOrgProfiles = currentOrgId ? await listSelectableProfiles() : [];
    const currentOrgNumericPick =
      currentOrgId && isProfileSelectionIndexInput(arg, currentOrgProfiles.length)
        ? resolveProfileInput(currentOrgProfiles, arg)
        : undefined;
    const currentOrgProfilePick =
      currentOrgId && isThread ? resolveProfileInput(currentOrgProfiles, arg) : undefined;
    const resolved =
      currentOrgId && (currentOrgNumericPick || currentOrgProfilePick)
        ? {
            scope: {
              orgId: currentOrgId,
              orgName: currentOrg?.name ?? "Current org",
              profiles: currentOrgProfiles,
            },
            profile: currentOrgNumericPick ?? currentOrgProfilePick!,
          }
        : isThread
          ? null
          : resolveProfileInScopes(await listProfileScopes(orgs, currentOrgId), arg);

    if (!resolved) {
      await messenger.send("Unknown profile. Send /profile to see the list.");
      return;
    }

    if ("ambiguous" in resolved) {
      await messenger.send(
        `That profile exists in multiple orgs (${resolved.ambiguous}). Send /org first, then /profile.`,
      );
      return;
    }

    const { scope, profile: picked } = resolved;

    if (scope.orgId !== currentOrgId) {
      orgStore.set(channelOrgKey, scope.orgId);
      await orgStore.save();
      client.setOrgId(scope.orgId);
      sessionStore.delete(conversationKey);
      await sessionStore.save();
    }

    if (picked.id === currentProfileId && scope.orgId === currentOrgId) {
      await messenger.send(`Already using ${picked.name}.`);
      return;
    }

    await createAndBindSession(conversationKey, picked.id);
    const orgNote = scope.orgId !== currentOrgId ? ` (${scope.orgName})` : "";
    await messenger.send(`${formatProfileSwitchConfirmation(picked.name)}${orgNote}`);
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

  async function replyStatus(messenger: DiscordMessenger, chatId: string): Promise<void> {
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
          : (profile?.model ?? "none");
        lines.push(`Profile: ${profile?.name ?? profileId}`);
        lines.push(`Provider: ${models.provider ?? "unknown"}`);
        lines.push(`Model: ${modelLabel}`);
      } else {
        lines.push("Chat runs in offline mode without an API key.");
      }

      await replyChunks(messenger, lines.join("\n"));
    } catch (error) {
      await messenger.send(formatError(error));
    }
  }

  async function resolveSession(chatId: string): Promise<RemoteChatSession> {
    const existing = sessionStore.get(chatId);

    if (existing) {
      const session = client.createChatSession(existing.sessionId, "discord");

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
    const session = await client.createSession("discord", {
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

  function clearSessionArtifactState(conversationKey: string): void {
    const existing = sessionStore.get(conversationKey);
    if (!existing) {
      return;
    }

    sessionStore.set(conversationKey, {
      sessionId: existing.sessionId,
      profileId: existing.profileId,
      updatedAt: new Date().toISOString(),
    });
    void sessionStore.save();
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
): { orgId: string } | undefined {
  const record = orgStore.get(channelOrgKey);

  if (!record) {
    return undefined;
  }

  return { orgId: record.orgId };
}

async function replyChunks(messenger: DiscordMessenger, text: string): Promise<void> {
  for (const chunk of splitDiscordMessage(text)) {
    await messenger.send(chunk);
  }
}

async function withChatLock(chatId: string, fn: () => Promise<void>): Promise<void> {
  const previous = chatLocks.get(chatId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  chatLocks.set(chatId, gate);

  await previous.catch(() => undefined);

  try {
    await fn();
  } finally {
    release();
  }
}
