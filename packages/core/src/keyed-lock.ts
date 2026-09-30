/**
 * Serializes work by key within one process.
 *
 * The point is to make a read-modify-write on a file atomic against other
 * callers: read, transform, write. Two of those interleaved lose one of the
 * writes, and the loser's data is not recoverable because it only ever existed
 * in memory. This is not a cross-process lock — a second server or a restarted
 * one is not covered — but it closes the in-process race, which is the one that
 * loses data on a single deployment.
 *
 * A rejected predecessor never blocks the next caller: `await previous` is
 * guarded, and the waiter's own error still surfaces from `work()`.
 */
const locks = new Map<string, Promise<unknown>>();

export async function withKeyedLock<T>(
  key: string,
  work: () => Promise<T>
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let releaseLock = () => {};
  const current = new Promise<void>((resolveLock) => {
    releaseLock = resolveLock;
  });
  const chained = previous.then(
    () => current,
    () => current
  );
  locks.set(key, chained);
  await previous.catch(() => undefined);

  try {
    return await work();
  } finally {
    releaseLock();
    if (locks.get(key) === chained) {
      locks.delete(key);
    }
  }
}

/** Test-only. Drops waiters so a suite does not leak state between cases. */
export function resetKeyedLocksForTests(): void {
  locks.clear();
}
