export const DEFAULT_CHAT_STREAM_TIMEOUT_MS = 1_800_000;
export const MIN_CHAT_STREAM_TIMEOUT_MS = 60_000;
export const MAX_CHAT_STREAM_TIMEOUT_MS = 3_600_000;

function readTimeoutEnvValue(
  env: Record<string, string | undefined>,
  key: string
): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

export function resolveChatStreamTimeoutMs(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = readTimeoutEnvValue(env, "NAKAMA_CHAT_STREAM_TIMEOUT_MS");
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
