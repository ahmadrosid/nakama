export interface TypingLoop {
  ping(): void;
  start(): void;
  stop(): void;
}

/**
 * Refreshes a channel's typing indicator until `stop()`.
 *
 * Sends are serialized and `active` is re-checked before each one so a ping
 * flood (e.g. onThinking) cannot keep refreshing the channel after stop().
 * `refreshMs` is per channel: the platforms expire the indicator at different
 * rates.
 */
export function createTypingLoop(
  send: () => Promise<unknown>,
  refreshMs: number
): TypingLoop {
  let interval: ReturnType<typeof setInterval> | null = null;
  let active = false;
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

        await send();
      })
      .catch(() => {
        // Chat may be gone, the bot blocked, or the connection lost. Keep the
        // chain healthy.
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
      }, refreshMs);
    },
    stop() {
      active = false;
      clear();
    },
  };
}
