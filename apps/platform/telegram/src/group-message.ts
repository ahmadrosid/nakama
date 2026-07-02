import type { Context } from "grammy";

export interface TelegramBotInfo {
  id: number;
  username?: string;
}

export interface GroupMessageHandlingDecision {
  shouldHandle: boolean;
  reason:
    | "slash-command"
    | "missing-bot-info"
    | "reply-to-bot"
    | "bot-mention"
    | "no-text"
    | "no-trigger";
}

export function isTelegramGroupChat(ctx: Context): boolean {
  const type = ctx.chat?.type;

  return type === "group" || type === "supergroup";
}

export function resolveChannelOrgKey(
  chatId: string,
  userId: number,
  isGroup: boolean,
): string {
  return isGroup ? `g:${chatId}` : `u:${userId}`;
}

export function resolveConversationKey(ctx: Context, chatId: string, isGroup: boolean): string {
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

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function resolveBotInfo(
  ctx: Context,
  storedBotInfo?: TelegramBotInfo | undefined,
): TelegramBotInfo | undefined {
  if (ctx.me?.id) {
    return { id: ctx.me.id, username: ctx.me.username };
  }

  if (storedBotInfo?.id) {
    return storedBotInfo;
  }

  return undefined;
}

export function shouldHandleGroupMessage(
  ctx: Context,
  storedBotInfo?: TelegramBotInfo | undefined,
): boolean {
  return explainGroupMessageHandling(ctx, storedBotInfo).shouldHandle;
}

export function explainGroupMessageHandling(
  ctx: Context,
  storedBotInfo?: TelegramBotInfo | undefined,
): GroupMessageHandlingDecision {
  const text = ctx.message?.text?.trim() ?? "";
  const botInfo = resolveBotInfo(ctx, storedBotInfo);

  if (text.startsWith("/")) {
    return { shouldHandle: true, reason: "slash-command" };
  }

  if (!botInfo) {
    return { shouldHandle: false, reason: "missing-bot-info" };
  }

  if (isReplyToBot(ctx, botInfo.id)) {
    return { shouldHandle: true, reason: "reply-to-bot" };
  }

  if (hasBotMention(ctx, botInfo)) {
    return { shouldHandle: true, reason: "bot-mention" };
  }

  return {
    shouldHandle: false,
    reason: text ? "no-trigger" : "no-text",
  };
}

export function stripBotMention(text: string, username: string | undefined): string {
  if (!username?.trim()) {
    return text.trim();
  }

  const mention = `@${username.trim()}`;
  const pattern = new RegExp(mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");

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
      "i",
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
