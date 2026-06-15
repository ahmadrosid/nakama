import type { WASocket } from "@whiskeysockets/baileys";

const TYPING_REFRESH_MS = 4_000;

export interface TypingLoop {
  start(): void;
  ping(): void;
  stop(): void;
}

export function createTypingLoop(
  socket: WASocket | null,
  jid: string,
): TypingLoop {
  let interval: ReturnType<typeof setInterval> | null = null;

  async function sendTyping(): Promise<void> {
    if (!socket) return;

    try {
      await socket.sendPresenceUpdate("composing", jid);
    } catch {
      // Connection may be lost — ignore.
    }
  }

  return {
    start() {
      void sendTyping();
      interval = setInterval(() => {
        void sendTyping();
      }, TYPING_REFRESH_MS);
    },
    ping() {
      void sendTyping();
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    },
  };
}