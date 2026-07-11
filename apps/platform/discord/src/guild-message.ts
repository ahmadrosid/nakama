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
    | "reply-to-bot"
    | "bot-mention"
    | "no-text"
    | "no-trigger";
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
): boolean {
  return explainGuildMessageHandling(message, storedBotInfo).shouldHandle;
}

export function explainGuildMessageHandling(
  message: Message,
  storedBotInfo?: DiscordBotInfo,
): GuildMessageHandlingDecision {
  const text = message.content?.trim() ?? "";
  const botInfo = resolveBotInfo(message, storedBotInfo);

  if (text.startsWith("/")) {
    return { shouldHandle: true, reason: "slash-command" };
  }

  if (!botInfo) {
    return { shouldHandle: false, reason: "missing-bot-info" };
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
