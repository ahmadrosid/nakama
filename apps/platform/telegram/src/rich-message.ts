import type { Context } from "grammy";
import { prepareTelegramFallbackReply, renderTelegramRichText } from "./format";

interface TelegramReplyMessage {
  message_id: number;
}

export interface TelegramRichMessenger {
  send(text: string): Promise<TelegramReplyMessage | undefined>;
  sendPlain(text: string): Promise<TelegramReplyMessage | undefined>;
  /** Send trimmed text with no markdown stripping (safe for share URLs / tokens). */
  sendRaw(text: string): Promise<TelegramReplyMessage | undefined>;
  edit(messageId: number, text: string): Promise<void>;
}

export function createTelegramRichMessenger(ctx: Context): TelegramRichMessenger {
  return {
    async send(text: string): Promise<TelegramReplyMessage | undefined> {
      return sendRichMessage(ctx, text).catch(async () => {
        return sendPlainMessage(ctx, text);
      });
    },
    async sendPlain(text: string): Promise<TelegramReplyMessage | undefined> {
      return sendPlainMessage(ctx, text);
    },
    async sendRaw(text: string): Promise<TelegramReplyMessage | undefined> {
      return sendRawMessage(ctx, text);
    },
    async edit(messageId: number, text: string): Promise<void> {
      await editRichMessage(ctx, messageId, text).catch(async () => {
        await editPlainMessage(ctx, messageId, text);
      });
    },
  };
}

async function sendRichMessage(
  ctx: Context,
  text: string,
): Promise<TelegramReplyMessage> {
  return (await ctx.reply(renderTelegramRichText(text), {
    parse_mode: "HTML",
  })) as TelegramReplyMessage;
}

async function editRichMessage(
  ctx: Context,
  messageId: number,
  text: string,
): Promise<void> {
  await ctx.api.editMessageText(getChatId(ctx), messageId, renderTelegramRichText(text), {
    parse_mode: "HTML",
  });
}

async function sendPlainMessage(
  ctx: Context,
  text: string,
): Promise<TelegramReplyMessage> {
  return (await ctx.reply(prepareTelegramFallbackReply(text))) as TelegramReplyMessage;
}

async function sendRawMessage(
  ctx: Context,
  text: string,
): Promise<TelegramReplyMessage> {
  return (await ctx.reply(text.trim())) as TelegramReplyMessage;
}

async function editPlainMessage(
  ctx: Context,
  messageId: number,
  text: string,
): Promise<void> {
  await ctx.api.editMessageText(getChatId(ctx), messageId, prepareTelegramFallbackReply(text));
}

function getChatId(ctx: Context): number {
  if (!ctx.chat) {
    throw new Error("Telegram chat context is missing");
  }

  return ctx.chat.id;
}

export type { TelegramReplyMessage };
