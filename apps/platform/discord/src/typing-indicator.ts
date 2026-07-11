import type { DiscordMessenger } from "./messenger";

const TYPING_REFRESH_MS = 8_000;

export interface TypingLoop {
  start(): void;
  ping(): void;
  stop(): void;
}

export function createTypingLoop(messenger: DiscordMessenger): TypingLoop {
  let interval: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      void messenger.sendTyping();
      interval = setInterval(() => {
        void messenger.sendTyping();
      }, TYPING_REFRESH_MS);
    },
    ping() {
      void messenger.sendTyping();
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    },
  };
}
