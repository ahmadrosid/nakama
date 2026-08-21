import { readEnvValue } from "./config";

export const DEFAULT_CHAT_STREAM_TIMEOUT_MS = 1_800_000;
export const MIN_CHAT_STREAM_TIMEOUT_MS = 60_000;
export const MAX_CHAT_STREAM_TIMEOUT_MS = 3_600_000;

export function resolveChatStreamTimeoutMs(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = readEnvValue(env, "NAKAMA_CHAT_STREAM_TIMEOUT_MS");
  if (!raw) {
    return DEFAULT_CHAT_STREAM_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CHAT_STREAM_TIMEOUT_MS;
  }

  return Math.min(
    MAX_CHAT_STREAM_TIMEOUT_MS,
    Math.max(MIN_CHAT_STREAM_TIMEOUT_MS, Math.floor(parsed))
  );
}

/**
 * A separate, much shorter budget for the provider's *first* output of a turn.
 *
 * The stream timeout has to stay long because a healthy turn can spend half an
 * hour in a tool loop. That same budget is far too generous for a provider that
 * accepted the connection and then said nothing at all, which is the case that
 * holds a session hostage with no way to reach it. Anything the provider emits
 * (a chunk, a thinking delta, a tool call) satisfies this deadline; the 4s
 * server keepalive does not, since it proves nothing about the provider.
 *
 * Set NAKAMA_CHAT_FIRST_TOKEN_TIMEOUT_MS to 0 to turn it off, for a deployment
 * whose model really does think for minutes before emitting anything.
 */
export const DEFAULT_CHAT_FIRST_TOKEN_TIMEOUT_MS = 120_000;
export const MIN_CHAT_FIRST_TOKEN_TIMEOUT_MS = 5000;

export function resolveChatFirstTokenTimeoutMs(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = readEnvValue(env, "NAKAMA_CHAT_FIRST_TOKEN_TIMEOUT_MS");
  if (!raw) {
    return DEFAULT_CHAT_FIRST_TOKEN_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CHAT_FIRST_TOKEN_TIMEOUT_MS;
  }

  if (parsed <= 0) {
    return 0;
  }

  return Math.max(MIN_CHAT_FIRST_TOKEN_TIMEOUT_MS, Math.floor(parsed));
}
