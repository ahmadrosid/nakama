export function sanitizeMailError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  return raw
    .replace(/(?:AUTH=PLAIN|LOGIN)\s+\S+/gi, "[REDACTED]")
    .replace(/\b[A-Za-z0-9]{4}\s?[A-Za-z0-9]{4}\s?[A-Za-z0-9]{4}\s?[A-Za-z0-9]{4}\b/g, "[REDACTED]")
    .replace(/password[=:\s]+[^\s]+/gi, "password=[REDACTED]");
}
