import { z } from "zod";

// Four groups of four, joined by spaces, dashes or nothing. A match never
// has the word "password" in its first 16 characters, so text such as
// "specific password required" or "your password must" stays readable.
const APP_PASSWORD =
  /(?<![A-Za-z0-9])(?!(?:[A-Za-z0-9][\s-]*){0,8}password)[A-Za-z0-9]{4}(?:[\s-]*[A-Za-z0-9]{4}){3}(?![A-Za-z0-9])/gi;

// After "password", every value is a secret, except the words of a hint
// such as "password required.".
const PASSWORD_VALUE =
  /password(?:[ \t]*[=:][ \t]*|[ \t]+(?![("'[]?(?:required|not|is|was|must|for|and|or|incorrect|invalid|expired)\b))\S+/gi;

export function sanitizeMailError<ErrorValue>(err: ErrorValue): string {
  const stringError = z.string().safeParse(err);

  const raw =
    err instanceof Error
      ? err.message
      : stringError.success
        ? stringError.data
        : String(err);

  return raw
    .replace(/(?:AUTH=PLAIN|LOGIN)\s+\S+/gi, "[REDACTED]")
    .replace(APP_PASSWORD, "[REDACTED]")
    .replace(PASSWORD_VALUE, "password=[REDACTED]");
}
