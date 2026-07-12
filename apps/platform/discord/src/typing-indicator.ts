import type { DiscordMessenger } from "./messenger";

const TYPING_REFRESH_MS = 8_000;

export interface TypingLoop {
  start(): void;
  ping(): void;
  stop(): void;
}

export function createTypingLoop(messenger: DiscordMessenger): TypingLoop {
  let interval: ReturnType<typeof setInterval> | null = null;
  let active = false;

  function clear() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  return {
    start() {
      clear();
      active = true;
      void messenger.sendTyping();
      interval = setInterval(() => {
        if (!active) {
          clear();
          return;
        }

        void messenger.sendTyping();
      }, TYPING_REFRESH_MS);
    },
    ping() {
      // Ignore late stream callbacks after stop() so we do not refresh Discord typing.
      if (!active) {
        return;
      }

      void messenger.sendTyping();
    },
    stop() {
      active = false;
      clear();
    },
  };
}
