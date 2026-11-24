import { z } from "zod";

export function sanitizeMailError<ErrorValue>(err: ErrorValue): string {
  const stringError = z.string().safeParse(err);

  const raw =
    err instanceof Error
      ? err.message
      : stringError.success
        ? stringError.data
        : String(err);

  // The app password pattern matches four groups of four, all spaced or none,
  // so it leaves words like "specific password" alone.
  return raw
    .replace(/(?:AUTH=PLAIN|LOGIN)\s+\S+/gi, "[REDACTED]")
    .replace(
      /\b[A-Za-z0-9]{4}(?:\s[A-Za-z0-9]{4}){3}\b|\b[A-Za-z0-9]{16}\b/g,
      "[REDACTED]"
    )
    .replace(/password[=:\s]+[^\s]+/gi, "password=[REDACTED]");
}
