import type { WASocket } from "@whiskeysockets/baileys";

const TYPING_REFRESH_MS = 4000;

export interface TypingLoop {
  ping(): void;
  start(): void;
  stop(): void;
}

export function createTypingLoop(
  socket: WASocket | null,
  jid: string
): TypingLoop {
  let interval: ReturnType<typeof setInterval> | null = null;

  async function sendTyping(): Promise<void> {
    if (!socket) {
      return;
    }

    try {
      await socket.sendPresenceUpdate("composing", jid);
    } catch {
      // Connection may be lost — ignore.
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
