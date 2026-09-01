export interface ChannelChatLock {
  getSizeForTests(): number;
  /** Mutable wait budget (ms). `0` = wait forever. Discord tests mutate this. */
  options: { waitMs: number };
  resetForTests(): void;
  seedForTests(key: string, promise: Promise<void>): void;
  withLock(key: string, fn: () => Promise<void>): Promise<void>;
}

/**
 * Serialize work per conversation key. Optional `waitMs` bounds how long a
 * waiter blocks on a prior run; after the budget the next call proceeds
 * concurrent with a wedged predecessor (Discord recovery path).
 */
export function createChatLock(defaults?: {
  waitMs?: number;
}): ChannelChatLock {
  const locks = new Map<string, Promise<void>>();
  const options = { waitMs: defaults?.waitMs ?? 0 };

  return {
    getSizeForTests() {
      return locks.size;
    },
    options,
    resetForTests() {
      locks.clear();
    },
    seedForTests(key, promise) {
      locks.set(key, promise);
    },
    async withLock(key, fn) {
      const previous = locks.get(key) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      locks.set(key, gate);

      const waitMs = options.waitMs;
      let timedOut = false;
      if (waitMs > 0) {
        timedOut = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(true), waitMs);
          previous
            .then(() => {
              clearTimeout(timer);
              resolve(false);
            })
            .catch(() => {
              clearTimeout(timer);
              resolve(false);
            });
        });
      } else {
        await previous.catch(() => undefined);
      }

      if (timedOut) {
        console.warn(
          `Chat lock for ${key} exceeded ${waitMs}ms wait; proceeding to recover from a wedged run.`
        );
      }

      try {
        await fn();
      } finally {
        release();
        if (locks.get(key) === gate) {
          locks.delete(key);
        }
      }
    },
  };
}
