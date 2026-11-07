const inFlight = new Set<string>();

/**
 * Runs an OAuth callback at most once at a time per state. The callbacks
 * check the stored state, await the exchange, then clear the state, so two
 * requests with one state could both pass the check. The claim is taken
 * before the first await, which makes it atomic within this process.
 */
export async function withClaimedOAuthState<T>(
  key: string,
  onConflict: () => Error,
  run: () => Promise<T>
): Promise<T> {
  if (inFlight.has(key)) {
    throw onConflict();
  }

  inFlight.add(key);

  try {
    return await run();
  } finally {
    inFlight.delete(key);
  }
}
