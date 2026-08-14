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
  let active = false;
  // Serialize presence updates and re-check `active` before each one so a ping
  // flood (e.g. onThinking) cannot keep refreshing WhatsApp after stop().
  let sendChain: Promise<void> = Promise.resolve();

  function clear() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  function queueTyping() {
    if (!(active && socket)) {
      return;
    }

    sendChain = sendChain
      .then(async () => {
        if (!(active && socket)) {
          return;
        }

        await socket.sendPresenceUpdate("composing", jid);
      })
      .catch(() => {
        // Connection may be lost. Keep the chain healthy.
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
