export const REDACTED_SECRET_VALUE = "••••••••";

/** Env vars that hold a secret and never reach a child process. */
export function isSecretEnvKey(key: string): boolean {
  return (
    key === "NAKAMA_SECRETS_KEY" ||
    key === "NAKAMA_SECRETS_KEY_NEXT" ||
    key === "NAKAMA_EMAIL_PASSWORD" ||
    key === "NAKAMA_EMAIL_PASSWORD_FILE" ||
    key.startsWith("NAKAMA_PROVIDER_API_KEY_") ||
    key.startsWith("NAKAMA_TOOL_API_KEY_") ||
    /(?:^|_)API_KEY(?:_FILE)?$/.test(key)
  );
}

/** Mask all but the last 4 characters; empty → null; short → full bullets. */
export function maskTrailingSecret(secret: string): string | null {
  const trimmed = secret.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length <= 8) {
    return REDACTED_SECRET_VALUE;
  }

  return `${"•".repeat(Math.min(trimmed.length - 4, 12))}${trimmed.slice(-4)}`;
}
