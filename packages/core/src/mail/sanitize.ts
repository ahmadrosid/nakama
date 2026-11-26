import { z } from "zod";

const KNOWN_PASSWORD_HINT =
  /^(?:Invalid login: )?(?:534[- ]5\.7\.9 Application-specific password required|535[- ]5\.7\.8 Username and Password not accepted|535 your password must be changed)\.?(?=\s|$)/i;

const APP_PASSWORD =
  /(?<![A-Za-z0-9])(?!password\b)[A-Za-z0-9]{4}(?:[\s-]*[A-Za-z0-9]{4}){3}(?![A-Za-z0-9])/gi;

export function sanitizeMailError<ErrorValue>(err: ErrorValue): string {
  const stringError = z.string().safeParse(err);

  const raw =
    err instanceof Error
      ? err.message
      : stringError.success
        ? stringError.data
        : String(err);

  const hint = raw.match(KNOWN_PASSWORD_HINT)?.[0] ?? "";

  const redacted = raw
    .slice(hint.length)
    .replace(/(?:AUTH=PLAIN|LOGIN)\s+\S+/gi, "[REDACTED]")
    .replace(APP_PASSWORD, "[REDACTED]")
    .replace(/password[=:\s]+\S+/gi, "password=[REDACTED]");

  return hint + redacted;
}
