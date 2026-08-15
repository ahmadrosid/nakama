/**
 * Bun fetch `idleTimeout` is in seconds (max 255). Long LLM completions and
 * automation HTTP waits can sit quiet longer than the default (10s), which
 * surfaces as "The socket connection was closed unexpectedly".
 */
export const BUN_FETCH_DISABLE_IDLE_TIMEOUT_S = 0;

/** Hard cap for one outbound LLM HTTP call after idle timeout is disabled. */
export const LLM_FETCH_TIMEOUT_MS = 600_000;

export type BunFetchInit = RequestInit & { idleTimeout?: number };

export function withDisabledFetchIdle(init?: RequestInit): BunFetchInit {
  return { ...init, idleTimeout: BUN_FETCH_DISABLE_IDLE_TIMEOUT_S };
}

export function withLlmFetchDeadline(init?: RequestInit): BunFetchInit {
  const deadline = AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, deadline])
    : deadline;

  return withDisabledFetchIdle({ ...init, signal });
}

export function fetchWithoutIdleTimeout(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  return fetch(input, withLlmFetchDeadline(init));
}
