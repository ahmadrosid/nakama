import type { Context } from "grammy";

const TYPING_REFRESH_MS = 4000;

export interface TypingLoop {
  ping(): void;
  start(): void;
  stop(): void;
}

export function createTypingLoop(ctx: Context): TypingLoop {
  let interval: ReturnType<typeof setInterval> | null = null;

  async function sendTyping(): Promise<void> {
    try {
      await ctx.replyWithChatAction("typing");
    } catch {
      // Chat may have been deleted or bot blocked — ignore.
    }
  }

  return {
    ping() {
      void sendTyping();
    },
    start() {
      void sendTyping();
      interval = setInterval(() => {
        void sendTyping();
      }, TYPING_REFRESH_MS);
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    },
  };
}
