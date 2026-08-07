import type { Message } from "discord.js";

export interface DiscordBotInfo {
  id: string;
  username?: string;
}

export interface GuildMessageHandlingDecision {
  shouldHandle: boolean;
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
  isGuild: boolean,
): string {
  return isGuild ? `g:${channelId}` : `u:${userId}`;
}

/** Parent guild channel for org selection — threads inherit the parent's org. */
export function resolveOrgChannelId(message: Message, channelId: string, isGuild: boolean): string {
  if (!isGuild) {
    return channelId;
  }

  if (message.channel.isThread()) {
    return message.channel.parentId ?? channelId;
  }

  return channelId;
}

export function resolveConversationKey(message: Message, channelId: string, isGuild: boolean): string {
  if (!isGuild) {
    return channelId;
  }

  if (message.channel.isThread()) {
    return `g:${message.channel.parentId ?? channelId}:t:${message.channel.id}`;
  }

  return channelId;
}

export function isDiscordThreadMessage(message: Message): boolean {
  return message.channel.isThread();
}

export function resolveBotInfo(
  message: Message,
  storedBotInfo?: DiscordBotInfo,
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
  options?: GuildMessageHandlingOptions,
): boolean {
  return explainGuildMessageHandling(message, storedBotInfo, options).shouldHandle;
}

export function explainGuildMessageHandling(
  message: Message,
  storedBotInfo?: DiscordBotInfo,
  options?: GuildMessageHandlingOptions,
): GuildMessageHandlingDecision {
  const text = message.content?.trim() ?? "";
  const botInfo = resolveBotInfo(message, storedBotInfo);

  if (text.startsWith("/")) {
    return { shouldHandle: true, reason: "slash-command" };
  }

  if (!botInfo) {
    return { shouldHandle: false, reason: "missing-bot-info" };
  }

  // Bot-owned threads continue without a mention. Foreign threads stay quiet
  // unless the user @mentions the bot or replies to it — then we claim the thread.
  if (message.channel.isThread()) {
    if (options?.botOwnsThread) {
      return { shouldHandle: true, reason: "in-thread" };
    }

    if (isReplyToBot(message, botInfo.id) || hasBotMention(message, botInfo)) {
      return { shouldHandle: true, reason: "claim-thread" };
    }

    return { shouldHandle: false, reason: "foreign-thread" };
  }

  if (isReplyToBot(message, botInfo.id)) {
    return { shouldHandle: true, reason: "reply-to-bot" };
  }

  if (hasBotMention(message, botInfo)) {
    return { shouldHandle: true, reason: "bot-mention" };
  }

  return {
    shouldHandle: false,
    reason: text ? "no-trigger" : "no-text",
  };
}

export function stripBotMention(text: string, botInfo: DiscordBotInfo | undefined): string {
  if (!botInfo) {
    return text.trim();
  }

  const patterns = [
    new RegExp(`<@!?${botInfo.id}>`, "g"),
    botInfo.username
      ? new RegExp(`@${botInfo.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi")
      : null,
  ].filter(Boolean) as RegExp[];

  let result = text;

  for (const pattern of patterns) {
    result = result.replace(pattern, "");
  }

  return result.replace(/\s+/g, " ").trim();
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
