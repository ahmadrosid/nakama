/**
 * Bun fetch `idleTimeout` is in seconds (max 255). Long LLM completions and
 * automation HTTP waits can sit quiet longer than the default (10s), which
 * surfaces as "The socket connection was closed unexpectedly".
 */
export const BUN_FETCH_DISABLE_IDLE_TIMEOUT_S = 0;

export type BunFetchInit = RequestInit & { idleTimeout?: number };

export function withDisabledFetchIdle(init?: RequestInit): BunFetchInit {
  return { ...init, idleTimeout: BUN_FETCH_DISABLE_IDLE_TIMEOUT_S };
}

export function fetchWithoutIdleTimeout(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  return fetch(input, withDisabledFetchIdle(init));
}
