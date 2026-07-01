import type { Context } from "grammy";
import { prepareTelegramFallbackReply, renderTelegramRichText } from "./format";

interface TelegramReplyMessage {
  message_id: number;
}

export interface TelegramRichMessenger {
  send(text: string): Promise<TelegramReplyMessage | undefined>;
  edit(messageId: number, text: string): Promise<void>;
}

export function createTelegramRichMessenger(ctx: Context): TelegramRichMessenger {
  return {
    async send(text: string): Promise<TelegramReplyMessage | undefined> {
      return sendRichMessage(ctx, text).catch(async () => {
        return (await ctx.reply(prepareTelegramFallbackReply(text))) as TelegramReplyMessage;
      });
    },
    async edit(messageId: number, text: string): Promise<void> {
      await editRichMessage(ctx, messageId, text).catch(async () => {
        await ctx.api.editMessageText(getChatId(ctx), messageId, prepareTelegramFallbackReply(text));
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

function getChatId(ctx: Context): number {
  if (!ctx.chat) {
    throw new Error("Telegram chat context is missing");
  }

  return ctx.chat.id;
}

export type { TelegramReplyMessage };
