import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Pairing codes are the only thing standing between a stranger's chat and an
 * agent's channel tools, so they carry 128 bits, live for minutes, are spent
 * exactly once, and every failure spends part of a small attempt budget.
 */
const PAIRING_CODE_BYTES = 16;
export const PAIRING_CODE_LENGTH = PAIRING_CODE_BYTES * 2;

/** Long enough to copy a code out of the dashboard, short enough to be useless later. */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

const PAIRING_CODE_PATTERN = new RegExp(`^[0-9A-F]{${PAIRING_CODE_LENGTH}}$`);

export function generatePairingCode(): string {
  return randomBytes(PAIRING_CODE_BYTES).toString("hex").toUpperCase();
}

/** Accepts what people actually paste: lowercase, spaces, and dash grouping. */
export function normalizePairingCode(input: string): string {
  return input
    .trim()
    .replace(/[\s-]+/g, "")
    .toUpperCase();
}

export function looksLikePairingCode(input: string): boolean {
  return PAIRING_CODE_PATTERN.test(normalizePairingCode(input));
}

export function pairingCodesMatch(
  candidate: string,
  expected: string
): boolean {
  const given = Buffer.from(normalizePairingCode(candidate), "utf8");
  const want = Buffer.from(normalizePairingCode(expected), "utf8");

  // timingSafeEqual throws on a length mismatch, and the throw itself leaks
  // the length, so equal lengths are checked first.
  return given.length === want.length && timingSafeEqual(given, want);
}

/** A code plus the moment it stops being usable. */
export interface PairingCodeSecret {
  code: string;
  expiresAt: string;
}

export function createPairingCodeSecret(now = Date.now()): PairingCodeSecret {
  return {
    code: generatePairingCode(),
    expiresAt: new Date(now + PAIRING_CODE_TTL_MS).toISOString(),
  };
}

/**
 * A code is live only while it carries a parseable expiry in the future. Codes
 * written before expiry tracking existed have none, so they count as expired
 * rather than as eternal.
 */
export function isPairingCodeActive(
  code: string | null,
  expiresAt: string | null,
  now = Date.now()
): boolean {
  if (!code) {
    return false;
  }

  const deadline = expiresAt ? Date.parse(expiresAt) : Number.NaN;

  return Number.isFinite(deadline) && now < deadline;
}

const MAX_PAIRING_FAILURES = 5;
const attempts = new Map<string, { fingerprint: string; failures: number }>();

/** Keep the five-guess limit with the active code in each worker process. */
export function getPairingAttemptBudget(scope: string, code: string) {
  const fingerprint = createHash("sha256").update(code).digest("hex");
  const current = attempts.get(scope);
  if (current?.fingerprint === fingerprint) {
    return current;
  }
  const fresh = { failures: 0, fingerprint };
  attempts.set(scope, fresh);
  return fresh;
}

export function isPairingAttemptBlocked(budget: { failures: number }): boolean {
  return budget.failures >= MAX_PAIRING_FAILURES;
}

export function recordPairingFailure(budget: { failures: number }): boolean {
  budget.failures += 1;
  return isPairingAttemptBlocked(budget);
}

/**
 * One message for every rejected attempt. A stranger learns only that the
 * pairing failed, never whether a code existed, expired, or ran out of
 * attempts.
 */
export function pairingFailureMessage(label: string): string {
  return `That pairing code did not work. Generate a new code in this agent’s Connections → ${label} and try again.`;
}
