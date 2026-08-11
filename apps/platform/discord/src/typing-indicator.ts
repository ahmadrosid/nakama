import type { DiscordMessenger } from "./messenger";

const TYPING_REFRESH_MS = 8000;

export interface TypingLoop {
  ping(): void;
  start(): void;
  stop(): void;
}

export function createTypingLoop(messenger: DiscordMessenger): TypingLoop {
  let interval: ReturnType<typeof setInterval> | null = null;
  let active = false;
  // Serialize typing POSTs and re-check `active` before each send so a ping
  // flood (e.g. onThinking) cannot keep refreshing Discord after stop().
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

        await messenger.sendTyping();
      })
      .catch(() => {
        // Best-effort; keep the chain healthy.
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
