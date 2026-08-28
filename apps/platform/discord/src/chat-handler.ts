import type { NakamaClient, RemoteChatSession } from "@nakama/client";
import { isAttachOnlyCommand } from "@nakama/core";
import { hasActiveAgentQuestionnaire } from "@nakama/core/agent-questionnaire";
import {
  clearActiveStream,
  isAbortError,
  registerActiveStream,
  stopActiveStream,
} from "@nakama/core/channel-active-stream";
import {
  type ChannelOrgStore,
  findOrgBySelectionInput,
  formatOrgSelectionPrompt,
  formatOrgSwitchConfirmation,
  prepareChannelOrgContext,
} from "@nakama/core/channel-org";
import type { ImageAttachment, SendMessageInput } from "@nakama/core/contract";
import { addDiscordAllowedUserId } from "@nakama/core/discord-config";
import {
  filterProfilesForChatAccess,
  formatProfileSelectionPrompt,
  formatProfileSwitchConfirmation,
  isProfileSelectionIndexInput,
  type ProfileScope,
  pickProfileForOrg,
  resolveProfileInput,
  resolveProfileInScopes,
} from "@nakama/core/profiles";
import type {
  ChatInputCommandInteraction,
  Message,
  TextBasedChannel,
  ThreadChannel,
} from "discord.js";
import type { DiscordAuthStore } from "./auth-store";
import {
  deliverDiscordTurnArtifactShares,
  maybeSendRequestedDiscordArtifactAttachment,
  uploadDiscordArtifactFromToolResult,
} from "./channel-artifact-flow";
import type { DiscordBridgeConfig } from "./config";
import { formatError, HELP_TEXT, splitDiscordMessage } from "./format";
import {
  type DiscordBotInfo,
  explainGuildMessageHandling,
  isDiscordGuildMessage,
  isDiscordThreadMessage,
  looksLikeHandshakeAttempt,
  parseTextCommand,
  resolveBotInfo,
  resolveChannelOrgKey,
  resolveConversationKey,
  resolveMentionedBotRoleIds,
  resolveOrgChannelId,
  stripBotMention,
} from "./guild-message";
import { buildDiscordImageInput, UNSUPPORTED_ATTACHMENT_REPLY } from "./images";
import { isIgnorableInteractionError } from "./interaction-errors";
import {
  createDiscordMessenger,
  createInteractionMessenger,
  type DiscordMessenger,
  getMessageChannel,
} from "./messenger";
import { DiscordQuestionnaireMessage } from "./questionnaire-message";
import type { SessionStore } from "./session-store";
import type { ThreadStore } from "./thread-store";
import { DiscordTodoStatusMessage } from "./todo-status-message";
import { createTypingLoop } from "./typing-indicator";

const chatLocks = new Map<string, Promise<void>>();
const THREAD_OWNERSHIP_LOCK_KEY = "__discord_thread_ownership__";

/**
 * Max time a queued message waits for the previous agent run on the same key.
 * Long enough for legitimate multi-minute tool/LLM turns; short enough that a
 * wedged run cannot silence a thread forever. Slash commands bypass this lock.
 */
export const chatLockOptions = {
  waitMs: 15 * 60 * 1000,
};

const GROUP_MESSAGE_PREFIX =
  "[Discord channel — your reply is visible to everyone in this channel.]\n";

/** Posted when tools start before the model wrote any status text. */
const DISCORD_EARLY_ACK_FALLBACK = "On it.";

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

const ALLOW_NOT_AUTHORIZED = "You are not authorized to use this command.";

export interface ChatHandlerDeps {
  authStore: DiscordAuthStore;
  client: NakamaClient;
  config: DiscordBridgeConfig;
  getBotInfo?: () => DiscordBotInfo | undefined;
  orgStore: ChannelOrgStore;
  sessionStore: SessionStore;
  threadStore: ThreadStore;
}

export function createChatHandler(deps: ChatHandlerDeps) {
  const {
    client,
    config,
    authStore,
    sessionStore,
    threadStore,
    orgStore,
    getBotInfo = () => undefined,
  } = deps;

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
    const isThread = isDiscordThreadMessage(message);
    const botInfo = resolveBotInfo(message, getBotInfo());
    // Ownership is by thread id alone — partial parentId cannot flip this to foreign.
    const botOwnsThread = isThread ? threadStore.hasThreadId(channelId) : false;
    const groupDecision = isGuild
      ? explainGuildMessageHandling(message, botInfo, { botOwnsThread })
      : null;

    console.log(
      "[discord] handle",
      groupDecision?.reason ?? (isGuild ? "none" : "dm"),
      { botId: botInfo?.id, botOwnsThread, channelId, isThread }
    );

    if (groupDecision && !groupDecision.shouldHandle) {
      console.log("[discord] skip", groupDecision.reason);
      return;
    }

    if (isThread && groupDecision?.reason === "claim-thread") {
      await trackOwnedThread(channelId);
      console.log("[discord] claimed thread", channelId);
    }

    const resolvedParentId = isThread
      ? await resolveThreadParentChannelId(message)
      : undefined;
    const parentResolution = resolvedParentId
      ? { parentChannelId: resolvedParentId }
      : undefined;
    const parentChannelId = resolveOrgChannelId(
      message,
      channelId,
      isGuild,
      parentResolution
    );
    // Threads share the parent channel's org selection — do not key by thread id.
    const channelOrgKey = resolveChannelOrgKey(
      parentChannelId,
      userId,
      isGuild
    );
    const conversationKey = resolveConversationKey(
      message,
      channelId,
      isGuild,
      parentResolution
    );

    // Auth/org/thread-create run without the agent-stream lock so parallel parent mentions
    // can each open a thread. Agent work locks per conversation/thread key below.
    await authStore.reload();
    const isAuthorized = authStore.isAuthorized(userId);

    if (!isAuthorized) {
      console.log("[discord] unauthorized", userId);
      if (isGuild) {
        await messenger.send(LINK_IN_PRIVATE_REPLY);
        return;
      }

      if (!text) {
        await messenger.send(
          "Send your pairing code as text to link this chat."
        );
        return;
      }

      await withChatLock(conversationKey, async () => {
        await handlePairing(text, userId, messenger);
      });
      return;
    }

    if (isGuild && text && looksLikeHandshakeAttempt(text)) {
      await messenger.send(LINK_IN_PRIVATE_REPLY);
      return;
    }

    const command = text?.startsWith("/") ? parseTextCommand(text) : null;
    const bypassOrgGate =
      command === "/help" || command === "/start" || command === "/org";

    const mentionedBotRoleIds = isGuild
      ? resolveMentionedBotRoleIds(message)
      : [];

    if (!bypassOrgGate) {
      const orgGateText =
        isGuild && text && botInfo
          ? stripBotMention(text, botInfo, mentionedBotRoleIds)
          : text;
      const orgReady = await ensureOrgReady(
        messenger,
        channelOrgKey,
        orgGateText
      );
      if (!orgReady) {
        console.log("[discord] skip org-gate", channelOrgKey);
        return;
      }
    }

    const imageBuild = await buildDiscordImageInput(message);

    if (imageBuild?.kind === "reject") {
      await messenger.send(imageBuild.message);
      return;
    }

    const imageInput = imageBuild?.kind === "input" ? imageBuild.input : null;

    if (!(text || imageInput)) {
      const hasStickers = (message.stickers?.size ?? 0) > 0;
      await messenger.send(
        hasStickers ? UNSUPPORTED_ATTACHMENT_REPLY : "Text messages only."
      );
      return;
    }

    if (text && (command === "/org" || command === "/profile")) {
      await withChatLock(conversationKey, async () => {
        await handleTextCommand(
          text,
          command,
          conversationKey,
          channelOrgKey,
          isThread,
          messenger
        );
      });
      return;
    }

    if (text?.startsWith("/") && !isAttachOnlyCommand(text)) {
      await messenger.send(
        "Use slash commands from Discord's command menu for session control."
      );
      return;
    }

    const messageText =
      text && isGuild && botInfo
        ? stripBotMention(text, botInfo, mentionedBotRoleIds)
        : (text ?? "");

    if (!(messageText || imageInput)) {
      return;
    }

    let replyChannel = channel;
    let replyConversationKey = conversationKey;
    let replyMessenger = messenger;
    let replyIsThread = isThread;

    const shouldRouteToThread =
      isGuild &&
      !isThread &&
      (groupDecision?.reason === "bot-mention" ||
        groupDecision?.reason === "reply-to-bot");

    if (shouldRouteToThread) {
      const thread = await createGuildThread(message, messageText);

      if (thread) {
        replyChannel = thread;
        replyConversationKey = `g:${channelId}:t:${thread.id}`;
        replyMessenger = createDiscordMessenger(thread);
        replyIsThread = true;
        console.log("[discord] thread created", thread.id);
      } else {
        console.log("[discord] thread create failed, falling back to channel");
      }
    }

    console.log(
      "[discord] chat start",
      replyConversationKey,
      `messageId=${message.id ?? "unknown"}`,
      `textBytes=${Buffer.byteLength(messageText, "utf8")}`
    );

    await withChatLock(replyConversationKey, async () => {
      await handleChatMessage(
        replyChannel,
        replyConversationKey,
        replyMessenger,
        messageText,
        isGuild,
        replyIsThread,
        imageInput?.images
      );
    });

    console.log("[discord] chat done", replyConversationKey);
  }

  async function createGuildThread(
    message: Message,
    messageText: string
  ): Promise<ThreadChannel | null> {
    let thread: ThreadChannel;
    try {
      thread = await message.startThread({
        autoArchiveDuration: 1440,
        name: deriveThreadName(messageText),
      });
    } catch (error) {
      console.error(
        "Failed to create Discord thread; falling back to channel reply:",
        error
      );
      return null;
    }

    await trackOwnedThread(thread.id);
    return thread;
  }

  /**
   * Register ownership in memory first, then persist. Save failures must not
   * leave a live Discord thread untracked (that yields permanent foreign-thread drops).
   */
  async function trackOwnedThread(threadId: string): Promise<void> {
    // Brief lock so concurrent ownership saves do not drop a newly created id.
    await withChatLock(THREAD_OWNERSHIP_LOCK_KEY, async () => {
      threadStore.add(threadId);
      try {
        await threadStore.save();
      } catch (error) {
        console.error(
          `Failed to persist Discord thread ownership for ${threadId}; keeping in-memory tracking:`,
          error
        );
      }
    });
  }

  async function handleCloseThread(
    interaction: ChatInputCommandInteraction,
    conversationKey: string,
    messenger: DiscordMessenger
  ): Promise<void> {
    const channel = interaction.channel;

    if (!channel?.isThread()) {
      await messenger.send("Use /close inside a bot conversation thread.");
      return;
    }

    if (!threadStore.hasThreadId(channel.id)) {
      await messenger.send("I can only close threads I started.");
      return;
    }

    stopActiveStream(conversationKey);

    await withChatLock(THREAD_OWNERSHIP_LOCK_KEY, async () => {
      if (threadStore.deleteByThreadId(channel.id)) {
        await threadStore.save();
      }
    });

    await messenger.send("Thread closed.");

    try {
      if (!channel.archived) {
        await channel.setArchived(true);
      }
    } catch (error) {
      console.error("Failed to archive Discord thread after /close:", error);
      await messenger.send(
        "Couldn't archive the thread. Check the bot's Manage Threads permission."
      );
    }
  }

  async function handleAllowCommand(
    interaction: ChatInputCommandInteraction,
    messenger: DiscordMessenger,
    requesterId: string
  ): Promise<void> {
    if (!authStore.isPaired(requesterId)) {
      await messenger.send(ALLOW_NOT_AUTHORIZED);
      return;
    }

    const targetUser = interaction.options.getUser("user");

    if (!targetUser) {
      await messenger.send("Choose a Discord user to allow.");
      return;
    }

    const result = await addDiscordAllowedUserId(targetUser.id);
    await authStore.reload();

    if (!result.ok) {
      await messenger.send(result.message);
      return;
    }

    if (result.alreadyAllowed) {
      await messenger.send(
        `<@${result.userId}> is already on the allowed list.`
      );
      return;
    }

    await messenger.send(`Added <@${result.userId}> to the allowed list.`);
  }

  async function handleSlashCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    // Caller (bot.ts) already deferred — do not wait on withChatLock here.
    // Agent replies hold that lock for a long time and would leave commands stuck.

    const userId = interaction.user.id;
    const channelId = interaction.channelId;
    const isGuild = !interaction.channel?.isDMBased();
    const isThread = Boolean(interaction.channel?.isThread());
    let threadParentId =
      isGuild &&
      isThread &&
      interaction.channel &&
      "parentId" in interaction.channel
        ? (interaction.channel.parentId ?? undefined)
        : undefined;
    if (isGuild && isThread && !threadParentId && interaction.channel) {
      threadParentId = await hydrateThreadParentId(interaction.channel);
    }
    const orgChannelId =
      isGuild && isThread ? (threadParentId ?? channelId) : channelId;
    const channelOrgKey = resolveChannelOrgKey(orgChannelId, userId, isGuild);
    const conversationKey = isGuild
      ? isThread
        ? `g:${threadParentId ?? channelId}:t:${interaction.channel!.id}`
        : channelId
      : channelId;

    const messenger = createInteractionMessenger(
      (content) => interaction.followUp({ content: content.slice(0, 2000) }),
      (content) => interaction.editReply({ content: content.slice(0, 2000) })
    );

    try {
      await authStore.reload();

      if (interaction.commandName === "allow") {
        await handleAllowCommand(interaction, messenger, userId);
        return;
      }

      if (!authStore.isAuthorized(userId)) {
        if (
          interaction.commandName === "start" ||
          interaction.commandName === "help"
        ) {
          await handlePairingSlash(interaction.commandName, messenger);
          return;
        }

        await messenger.send(
          interaction.channel?.isDMBased()
            ? PAIRING_PROMPT
            : LINK_IN_PRIVATE_REPLY
        );
        return;
      }

      if (
        interaction.commandName === "start" ||
        interaction.commandName === "help"
      ) {
        await messenger.send(HELP_TEXT);
        return;
      }

      if (interaction.commandName === "stop") {
        if (stopActiveStream(conversationKey)) {
          await messenger.send("Stopping…");
        } else {
          await messenger.send("Nothing to stop.");
        }
        return;
      }

      if (interaction.commandName === "close") {
        await handleCloseThread(interaction, conversationKey, messenger);
        return;
      }

      const orgReady = await ensureOrgReady(
        messenger,
        channelOrgKey,
        undefined
      );
      if (!orgReady) {
        return;
      }

      switch (interaction.commandName) {
        case "clear": {
          stopActiveStream(conversationKey);
          const session = await resolveSession(conversationKey);
          await session.clear();
          await clearSessionArtifactState(conversationKey);
          await messenger.send("History cleared.");
          return;
        }
        case "compact": {
          stopActiveStream(conversationKey);
          const session = await resolveSession(conversationKey);
          const result = await session.compact({ force: true });
          await messenger.send(
            `Compacted (${result.action}). Messages: ${result.messagesAfter}.`
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
        console.warn(
          "Slash command interaction expired before reply could be sent."
        );
        return;
      }

      console.error("Slash command error:", error);
      await messenger.send(formatError(error)).catch(() => {});
    }
  }

  async function handlePairing(
    text: string,
    userId: string,
    messenger: DiscordMessenger
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
    messenger: DiscordMessenger
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
    messenger: DiscordMessenger
  ): Promise<void> {
    if (command === "/org") {
      await handleOrgCommand(text, channelOrgKey, conversationKey, messenger);
      return;
    }

    if (command === "/profile") {
      await handleProfileCommand(
        text,
        conversationKey,
        channelOrgKey,
        isThread,
        messenger
      );
    }
  }

  async function handleChatMessage(
    channel: TextBasedChannel,
    conversationKey: string,
    messenger: DiscordMessenger,
    attachUserText: string,
    isGuild: boolean,
    isThread: boolean,
    images?: ImageAttachment[]
  ): Promise<void> {
    const session = await resolveSession(conversationKey);
    const profileId = sessionStore.get(conversationKey)?.profileId;

    // `/attach` remains a non-LLM shortcut. Natural-language sends use the
    // send_discord_artifact tool from the agent turn.
    if (profileId && isAttachOnlyCommand(attachUserText)) {
      await maybeSendRequestedDiscordArtifactAttachment({
        attachUserText,
        channel,
        client,
        conversationKey,
        messenger,
        profileId,
        sessionStore,
      });
      return;
    }

    // Forward free text to the agent — do not gate Discord replies on questionnaire parsing.
    const streamInput = withGroupContext(
      {
        images,
        message: attachUserText,
      },
      isGuild,
      isThread
    );

    const signal = registerActiveStream(conversationKey);
    const typingLoop = createTypingLoop(messenger);
    const todoStatus = new DiscordTodoStatusMessage(messenger);
    const questionnaireStatus = new DiscordQuestionnaireMessage(messenger);
    typingLoop.start();

    let reply = "";
    let earlyAck: Promise<void> | undefined;
    let postedQuestionnaire = false;
    const pendingArtifactUploads: Promise<unknown>[] = [];

    try {
      reply = await session.sendStream(
        streamInput,
        {
          onChunk: (delta) => {
            reply += delta;
          },
          onQuestionnaireUpdated: (questionnaire) => {
            typingLoop.ping();
            if (hasActiveAgentQuestionnaire(questionnaire)) {
              postedQuestionnaire = true;
              void questionnaireStatus.update(questionnaire);
            }
          },
          onThinking: () => {
            typingLoop.ping();
          },
          onTodosUpdated: (todos) => {
            typingLoop.ping();
            void todoStatus.update(todos);
          },
          onToolEnd: (event) => {
            typingLoop.ping();
            if (!(profileId && event.tool === "send_discord_artifact")) {
              return;
            }

            pendingArtifactUploads.push(
              uploadDiscordArtifactFromToolResult({
                channel,
                client,
                messenger,
                profileId,
                result: event.result,
              })
            );
          },
          onToolStart: () => {
            typingLoop.ping();
            if (earlyAck) {
              return;
            }

            const earlyText = reply.trim() || DISCORD_EARLY_ACK_FALLBACK;
            reply = "";
            earlyAck = messenger.send(earlyText);
          },
        },
        { signal }
      );

      await Promise.all(pendingArtifactUploads);
      await earlyAck;
      await todoStatus.complete();

      if (signal.aborted) {
        if (reply.trim()) {
          await messenger.send(reply);
        }

        await messenger.send("Stopped.");
        return;
      }
    } catch (error) {
      await earlyAck;
      if (isAbortError(error)) {
        await todoStatus.stop();
        if (reply.trim()) {
          await messenger.send(reply);
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
      await messenger.send(reply);
    } else if (!(postedQuestionnaire || earlyAck)) {
      await messenger.send("(empty reply)");
    }

    if (profileId) {
      await deliverDiscordTurnArtifactShares({
        channel,
        client,
        conversationKey,
        messenger,
        profileId,
        session,
        sessionStore,
      });
    }
  }

  async function ensureOrgReady(
    messenger: DiscordMessenger,
    channelOrgKey: string,
    messageText: string | undefined
  ): Promise<boolean> {
    const orgContext = await prepareChannelOrgContext({
      getSelectedOrgId: () => orgStore.get(channelOrgKey)?.orgId,
      listOrgs: () => client.listUserOrgs(),
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
    messenger: DiscordMessenger
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
        formatOrgSelectionPrompt(orgs, orgStore.get(channelOrgKey)?.orgId)
      );
      return;
    }

    const picked = findOrgBySelectionInput(arg, orgs);

    if (!picked) {
      await messenger.send("Unknown organization. Send /org to see the list.");
      return;
    }

    const previousOrgId = orgStore.get(channelOrgKey)?.orgId;
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
    messenger: DiscordMessenger
  ): Promise<void> {
    const { orgs } = await client.listUserOrgs();
    const currentOrgId = orgStore.get(channelOrgKey)?.orgId;
    const currentOrg = currentOrgId
      ? orgs.find((org) => org.id === currentOrgId)
      : undefined;
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
        formatProfileSelectionPrompt(
          profiles,
          currentProfileId,
          currentOrg?.name
        )
      );
      return;
    }

    const currentOrgProfiles = currentOrgId
      ? await listSelectableProfiles()
      : [];
    const currentOrgNumericPick =
      currentOrgId &&
      isProfileSelectionIndexInput(arg, currentOrgProfiles.length)
        ? resolveProfileInput(currentOrgProfiles, arg)
        : undefined;
    const currentOrgProfilePick =
      currentOrgId && isThread
        ? resolveProfileInput(currentOrgProfiles, arg)
        : undefined;
    const resolved =
      currentOrgId && (currentOrgNumericPick || currentOrgProfilePick)
        ? {
            profile: currentOrgNumericPick ?? currentOrgProfilePick!,
            scope: {
              orgId: currentOrgId,
              orgName: currentOrg?.name ?? "Current org",
              profiles: currentOrgProfiles,
            },
          }
        : isThread
          ? null
          : resolveProfileInScopes(await listProfileScopes(orgs), arg);

    if (!resolved) {
      await messenger.send("Unknown profile. Send /profile to see the list.");
      return;
    }

    if ("ambiguous" in resolved) {
      await messenger.send(
        `That profile exists in multiple orgs (${resolved.ambiguous}). Send /org first, then /profile.`
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
    const orgNote = scope.orgId === currentOrgId ? "" : ` (${scope.orgName})`;
    await messenger.send(
      `${formatProfileSwitchConfirmation(picked.name)}${orgNote}`
    );
  }

  // The org travels with the request. Borrowing client.setOrgId per iteration
  // let a concurrent chat read another org's profiles between the awaits.
  async function listProfileScopes(
    orgs: Array<{ id: string; name: string }>
  ): Promise<ProfileScope[]> {
    const scopes: ProfileScope[] = [];

    for (const org of orgs) {
      const profiles = await listSelectableProfiles(org.id);

      if (profiles.length > 0) {
        scopes.push({ orgId: org.id, orgName: org.name, profiles });
      }
    }

    return scopes;
  }

  async function listSelectableProfiles(orgId?: string) {
    const { profiles } = await client.listProfiles(orgId);
    return filterProfilesForChatAccess(profiles, { excludeSuperBot: true });
  }

  async function replyStatus(
    messenger: DiscordMessenger,
    chatId: string
  ): Promise<void> {
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
    profileId?: string
  ): Promise<RemoteChatSession> {
    const resolvedProfileId =
      profileId ?? (await resolveSessionProfileId(chatId));
    const session = await client.createSession("discord", {
      profileId: resolvedProfileId,
    });

    sessionStore.set(chatId, {
      profileId: resolvedProfileId,
      sessionId: session.id,
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

    // New thread sessions inherit the parent channel's /profile selection.
    const parentChannelId = parentChannelIdFromConversationKey(chatId);
    if (parentChannelId) {
      const parentProfileId = sessionStore.get(parentChannelId)?.profileId;
      if (parentProfileId) {
        const match = profiles.find(
          (profile) => profile.id === parentProfileId
        );
        if (match) {
          return match.id;
        }
      }
    }

    return pickProfileForOrg(profiles, config.profileId).id;
  }

  async function clearSessionArtifactState(
    conversationKey: string
  ): Promise<void> {
    const existing = sessionStore.get(conversationKey);
    if (!existing) {
      return;
    }

    sessionStore.set(conversationKey, {
      profileId: existing.profileId,
      sessionId: existing.sessionId,
      updatedAt: new Date().toISOString(),
    });
    await sessionStore.save();
  }
}

function withGroupContext(
  input: SendMessageInput,
  isGuild: boolean,
  isThread: boolean
): SendMessageInput {
  // Threads are a private-ish conversation surface — skip the public-channel warning.
  if (!isGuild || isThread) {
    return input;
  }

  const message = input.message?.trim();

  if (message) {
    return { ...input, message: `${GROUP_MESSAGE_PREFIX}${message}` };
  }

  return { ...input, message: GROUP_MESSAGE_PREFIX.trim() };
}

function deriveThreadName(messageText: string): string {
  const cleaned = messageText.replace(/\s+/g, " ").trim();

  if (!cleaned) {
    return "Nakama chat";
  }

  // Discord thread names are capped at 100 characters.
  if (cleaned.length <= 100) {
    return cleaned;
  }

  const sliced = cleaned.slice(0, 100);
  const lastSpace = sliced.lastIndexOf(" ");

  if (lastSpace > 40) {
    return sliced.slice(0, lastSpace);
  }

  return sliced;
}

async function replyChunks(
  messenger: DiscordMessenger,
  text: string
): Promise<void> {
  for (const chunk of splitDiscordMessage(text)) {
    await messenger.send(chunk);
  }
}

/** Parent guild channel id from `g:{parent}:t:{thread}` conversation keys. */
function parentChannelIdFromConversationKey(
  chatId: string
): string | undefined {
  const match = /^g:(.+):t:(.+)$/.exec(chatId);
  return match?.[1];
}

/**
 * Hydrate parent guild channel id for thread messages when Discord delivers a
 * partial channel (`Partials.Channel`) without `parentId`. Ownership checks use
 * the thread id alone; this only protects org + conversation keys.
 */
async function resolveThreadParentChannelId(
  message: Message
): Promise<string | undefined> {
  if (!message.channel.isThread()) {
    return;
  }

  if (message.channel.parentId) {
    return message.channel.parentId;
  }

  return hydrateThreadParentId(message.channel);
}

async function hydrateThreadParentId(
  channel: TextBasedChannel | { fetch?: () => Promise<unknown>; id?: string }
): Promise<string | undefined> {
  if (typeof channel.fetch !== "function") {
    return;
  }

  try {
    const fetched = await channel.fetch();
    if (fetched && typeof fetched === "object" && "isThread" in fetched) {
      const thread = fetched as ThreadChannel;
      if (
        typeof thread.isThread === "function" &&
        thread.isThread() &&
        thread.parentId
      ) {
        return thread.parentId;
      }
    }
  } catch (error) {
    const id = "id" in channel ? String(channel.id) : "unknown";
    console.warn(`Failed to hydrate Discord thread parentId for ${id}:`, error);
  }
}

/**
 * Serialize work per conversation key. Waiting for a prior run is bounded so a
 * hung agent turn cannot queue follow-ups forever; after the wait budget the
 * next message proceeds (concurrent with the wedged run).
 */
export async function withChatLock(
  chatId: string,
  fn: () => Promise<void>
): Promise<void> {
  const previous = chatLocks.get(chatId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  chatLocks.set(chatId, gate);

  const waitMs = chatLockOptions.waitMs;
  let timedOut = false;
  if (waitMs > 0) {
    timedOut = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(true), waitMs);
      previous
        .then(() => {
          clearTimeout(timer);
          resolve(false);
        })
        .catch(() => {
          clearTimeout(timer);
          resolve(false);
        });
    });
  } else {
    await previous.catch(() => undefined);
  }

  if (timedOut) {
    console.warn(
      `Chat lock for ${chatId} exceeded ${waitMs}ms wait; proceeding to recover from a wedged run.`
    );
  }

  try {
    await fn();
  } finally {
    release();
  }
}

/** @internal Test helper — clears the in-process chat lock map. */
export function resetChatLocksForTests(): void {
  chatLocks.clear();
}
