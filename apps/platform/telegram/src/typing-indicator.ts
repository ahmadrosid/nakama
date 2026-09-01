import {
  createTypingLoop as createSharedTypingLoop,
  type TypingLoop,
} from "@nakama/core/channel-typing-loop";
import type { Context } from "grammy";

export type { TypingLoop };

export function createTypingLoop(ctx: Context): TypingLoop {
  return createSharedTypingLoop(() => ctx.replyWithChatAction("typing"));
}
