import type { Message } from "discord.js";

export interface DiscordBotInfo {
  id: string;
  username?: string;
}

export interface GuildMessageHandlingDecision {
  reason:
    | "slash-command"
    | "missing-bot-info"
    | "in-thread"
    | "foreign-thread"
    | "claim-thread"
    | "reply-to-bot"
    | "bot-mention"
    | "no-text"
    | "no-trigger";
  shouldHandle: boolean;
}

export interface GuildMessageHandlingOptions {
  /** True when the message is in a thread the Discord agent started and tracks. */
  botOwnsThread?: boolean;
}

export function isDiscordGuildMessage(message: Message): boolean {
  return !message.channel.isDMBased();
}

export function resolveChannelOrgKey(
  channelId: string,
  userId: string,
  isGuild: boolean
): string {
  return isGuild ? `g:${channelId}` : `u:${userId}`;
}

/**
 * Optional overrides when Discord delivers a partial thread (`parentId` missing).
 * Callers should hydrate via `channel.fetch()` first.
 */
export interface ThreadParentResolution {
  /** Known parent guild channel id when `message.channel.parentId` is unset. */
  parentChannelId?: string;
}

/** Parent guild channel for org selection — threads inherit the parent's org. */
export function resolveOrgChannelId(
  message: Message,
  channelId: string,
  isGuild: boolean,
  options?: ThreadParentResolution
): string {
  if (!isGuild) {
    return channelId;
  }

  if (message.channel.isThread()) {
    return message.channel.parentId ?? options?.parentChannelId ?? channelId;
  }

  return channelId;
}

export function resolveConversationKey(
  message: Message,
  channelId: string,
  isGuild: boolean,
  options?: ThreadParentResolution
): string {
  if (!isGuild) {
    return channelId;
  }

  if (message.channel.isThread()) {
    const parentId =
      message.channel.parentId ?? options?.parentChannelId ?? channelId;
    return `g:${parentId}:t:${message.channel.id}`;
  }

  return channelId;
}

export function isDiscordThreadMessage(message: Message): boolean {
  return message.channel.isThread();
}

export function resolveBotInfo(
  message: Message,
  storedBotInfo?: DiscordBotInfo
): DiscordBotInfo | undefined {
  if (message.client.user?.id) {
    return {
      id: message.client.user.id,
      username: message.client.user.username ?? undefined,
    };
  }

  return storedBotInfo;
}

export function shouldHandleGuildMessage(
  message: Message,
  storedBotInfo?: DiscordBotInfo,
  options?: GuildMessageHandlingOptions
): boolean {
  return explainGuildMessageHandling(message, storedBotInfo, options)
    .shouldHandle;
}

export function explainGuildMessageHandling(
  message: Message,
  storedBotInfo?: DiscordBotInfo,
  options?: GuildMessageHandlingOptions
): GuildMessageHandlingDecision {
  const text = message.content?.trim() ?? "";
  const botInfo = resolveBotInfo(message, storedBotInfo);

  if (text.startsWith("/")) {
    return { reason: "slash-command", shouldHandle: true };
  }

  if (!botInfo) {
    return { reason: "missing-bot-info", shouldHandle: false };
  }

  // Bot-owned threads continue without a mention. Foreign threads stay quiet
  // unless the user @mentions the bot or replies to it — then we claim the thread.
  if (message.channel.isThread()) {
    if (options?.botOwnsThread) {
      return { reason: "in-thread", shouldHandle: true };
    }

    if (isReplyToBot(message, botInfo.id) || hasBotMention(message, botInfo)) {
      return { reason: "claim-thread", shouldHandle: true };
    }

    return { reason: "foreign-thread", shouldHandle: false };
  }

  if (isReplyToBot(message, botInfo.id)) {
    return { reason: "reply-to-bot", shouldHandle: true };
  }

  if (hasBotMention(message, botInfo)) {
    return { reason: "bot-mention", shouldHandle: true };
  }

  return {
    reason: text ? "no-trigger" : "no-text",
    shouldHandle: false,
  };
}

export function stripBotMention(
  text: string,
  botInfo: DiscordBotInfo | undefined,
  roleIds: readonly string[] = []
): string {
  const patterns: RegExp[] = [];

  if (botInfo) {
    patterns.push(new RegExp(`<@!?${botInfo.id}>`, "g"));
    if (botInfo.username) {
      patterns.push(
        new RegExp(
          `@${botInfo.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
          "gi"
        )
      );
    }
  }

  for (const roleId of roleIds) {
    patterns.push(new RegExp(`<@&${roleId}>`, "g"));
  }

  if (patterns.length === 0) {
    return text.trim();
  }

  let result = text;

  for (const pattern of patterns) {
    result = result.replace(pattern, "");
  }

  return result.replace(/\s+/g, " ").trim();
}

/** Role IDs mentioned in the message that the bot currently holds (excludes @everyone). */
export function resolveMentionedBotRoleIds(message: Message): string[] {
  const guild = message.guild;
  const botMember = guild?.members.me;

  if (!(guild && botMember)) {
    return [];
  }

  const everyoneRoleId = guild.id;
  const roleIds: string[] = [];

  for (const roleId of message.mentions.roles.keys()) {
    if (roleId === everyoneRoleId) {
      continue;
    }

    if (botMember.roles.cache.has(roleId)) {
      roleIds.push(roleId);
    }
  }

  return roleIds;
}

function isReplyToBot(message: Message, botId: string): boolean {
  const referenced = message.reference?.messageId;

  if (!referenced) {
    return false;
  }

  const cached = message.channel.messages.cache.get(referenced);

  return cached?.author.id === botId;
}

function hasBotMention(message: Message, botInfo: DiscordBotInfo): boolean {
  if (message.mentions.users.has(botInfo.id)) {
    return true;
  }

  // Users often pick a role with the bot's name from autocomplete (`<@&role>`),
  // which does not populate mentions.users — treat held role pings as triggers.
  if (resolveMentionedBotRoleIds(message).length > 0) {
    return true;
  }

  if (botInfo.username) {
    const mention = `@${botInfo.username}`;
    return message.content.toLowerCase().includes(mention.toLowerCase());
  }

  return false;
}

export function parseTextCommand(text: string): string {
  const first = text.trim().split(/\s+/)[0] ?? "";
  const command = first.split("@")[0] ?? first;
  return command.toLowerCase();
}

export function looksLikeHandshakeAttempt(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, "").toUpperCase();
  return /^[0-9A-F]{8}$/.test(normalized);
}
