import type { Context } from "grammy";

const TYPING_REFRESH_MS = 4000;

export interface TypingLoop {
  ping(): void;
  start(): void;
  stop(): void;
}

export function createTypingLoop(ctx: Context): TypingLoop {
  let interval: ReturnType<typeof setInterval> | null = null;
  let active = false;
  // Serialize typing sends and re-check `active` before each one so a ping
  // flood (e.g. onThinking) cannot keep refreshing Telegram after stop().
  let sendChain: Promise<void> = Promise.resolve();

  function clear() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  function queueTyping() {
    if (!active) {
      return;
    }

    sendChain = sendChain
      .then(async () => {
        if (!active) {
          return;
        }

        await ctx.replyWithChatAction("typing");
      })
      .catch(() => {
        // Chat may have been deleted or bot blocked. Keep the chain healthy.
      });
  }

  return {
    ping() {
      queueTyping();
    },
    start() {
      clear();
      active = true;
      queueTyping();
      interval = setInterval(() => {
        queueTyping();
      }, TYPING_REFRESH_MS);
    },
    stop() {
      active = false;
      clear();
    },
  };
}
