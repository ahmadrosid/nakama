export interface TypingLoop {
  ping(): void;
  start(): void;
  stop(): void;
}

/** Shared typing/presence refresh loop for channel bridges. */
export function createTypingLoop(
  send: () => Promise<void>,
  options?: { refreshMs?: number }
): TypingLoop {
  const refreshMs = options?.refreshMs ?? 4000;
  let interval: ReturnType<typeof setInterval> | null = null;
  let active = false;
  // Serialize sends and re-check `active` before each one so a ping flood
  // (e.g. onThinking) cannot keep refreshing after stop().
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
        // Channel may be gone or blocked. Keep the chain healthy.
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
