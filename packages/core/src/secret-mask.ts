export const REDACTED_SECRET_VALUE = "••••••••";

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
