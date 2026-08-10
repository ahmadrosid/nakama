import type { Context } from "grammy";

export interface TelegramBotInfo {
  id: number;
  username?: string;
}

export interface GroupMessageHandlingDecision {
  reason:
    | "slash-command"
    | "missing-bot-info"
    | "reply-to-bot"
    | "bot-mention"
    | "no-text"
    | "no-trigger";
  shouldHandle: boolean;
}

export function isTelegramGroupChat(ctx: Context): boolean {
  const type = ctx.chat?.type;

  return type === "group" || type === "supergroup";
}

export function resolveChannelOrgKey(
  chatId: string,
  userId: number,
  isGroup: boolean
): string {
  return isGroup ? `g:${chatId}` : `u:${userId}`;
}

export function resolveConversationKey(
  ctx: Context,
  chatId: string,
  isGroup: boolean
): string {
  if (!isGroup) {
    return chatId;
  }

  const topicId = getTelegramTopicId(ctx);
  return topicId === undefined ? chatId : `g:${chatId}:t:${topicId}`;
}

export function isTelegramTopicMessage(ctx: Context): boolean {
  return getTelegramTopicId(ctx) !== undefined;
}

function getTelegramTopicId(ctx: Context): number | undefined {
  const value = (ctx.message as { message_thread_id?: unknown } | undefined)
    ?.message_thread_id;

  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function resolveBotInfo(
  ctx: Context,
  storedBotInfo?: TelegramBotInfo | undefined
): TelegramBotInfo | undefined {
  if (ctx.me?.id) {
    return { id: ctx.me.id, username: ctx.me.username };
  }

  if (storedBotInfo?.id) {
    return storedBotInfo;
  }
}

export function shouldHandleGroupMessage(
  ctx: Context,
  storedBotInfo?: TelegramBotInfo | undefined
): boolean {
  return explainGroupMessageHandling(ctx, storedBotInfo).shouldHandle;
}

export function explainGroupMessageHandling(
  ctx: Context,
  storedBotInfo?: TelegramBotInfo | undefined
): GroupMessageHandlingDecision {
  const text = ctx.message?.text?.trim() ?? "";
  const botInfo = resolveBotInfo(ctx, storedBotInfo);

  if (text.startsWith("/")) {
    return { reason: "slash-command", shouldHandle: true };
  }

  if (!botInfo) {
    return { reason: "missing-bot-info", shouldHandle: false };
  }

  if (isReplyToBot(ctx, botInfo.id)) {
    return { reason: "reply-to-bot", shouldHandle: true };
  }

  if (hasBotMention(ctx, botInfo)) {
    return { reason: "bot-mention", shouldHandle: true };
  }

  return {
    reason: text ? "no-trigger" : "no-text",
    shouldHandle: false,
  };
}

export function stripBotMention(
  text: string,
  username: string | undefined
): string {
  if (!username?.trim()) {
    return text.trim();
  }

  const mention = `@${username.trim()}`;
  const pattern = new RegExp(
    mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "gi"
  );

  return text.replace(pattern, "").replace(/\s+/g, " ").trim();
}

function isReplyToBot(ctx: Context, botId: number): boolean {
  const from = ctx.message?.reply_to_message?.from;

  return from?.id === botId;
}

function hasBotMention(ctx: Context, botInfo: TelegramBotInfo): boolean {
  const entities = ctx.message?.entities ?? [];
  const text = ctx.message?.text ?? "";
  const username = botInfo.username?.trim();

  if (username) {
    const mention = `@${username}`;
    const mentionPattern = new RegExp(
      `@${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\b|$)`,
      "i"
    );

    if (mentionPattern.test(text)) {
      return true;
    }

    for (const entity of entities) {
      if (entity.type === "mention") {
        const slice = text.slice(entity.offset, entity.offset + entity.length);

        if (slice.toLowerCase() === mention.toLowerCase()) {
          return true;
        }
      }
    }
  }

  for (const entity of entities) {
    if (entity.type === "text_mention" && entity.user?.id === botInfo.id) {
      return true;
    }
  }

  return false;
}
