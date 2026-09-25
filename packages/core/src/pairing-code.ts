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

/** Identifies a code in the attempt budget without keeping the secret itself. */
export function fingerprintPairingCode(code: string): string {
  return createHash("sha256").update(normalizePairingCode(code)).digest("hex");
}

export interface PairingAttemptLimits {
  /** Across every sender reaching this bridge. */
  global: number;
  /** Against one issued code; hitting it retires the code. */
  perCode: number;
  /** One messaging identity. */
  perSender: number;
  /** One network source. */
  perSource: number;
}

export const PAIRING_ATTEMPT_LIMITS: PairingAttemptLimits = {
  global: 100,
  perCode: 5,
  perSender: 10,
  perSource: 25,
};

export const PAIRING_ATTEMPT_WINDOW_MS = 30 * 60 * 1000;

export type PairingLimit = "code" | "global" | "sender" | "source";

export interface PairingAttemptInput {
  /** `fingerprintPairingCode` of the code the sender claims to hold. */
  codeFingerprint: string | null;
  senderKey: string;
  sourceKey: string;
}

/** Bounds counter memory; a flood of one-off senders must not grow it forever. */
const MAX_TRACKED_KEYS = 10_000;

/**
 * Rolling-window failure counters for one pairing scope. The scope is the
 * channel config directory, so the budget follows the agent it protects and
 * dies with a restart.
 */
export class PairingAttemptBudget {
  private readonly codes = new Map<string, number[]>();
  private readonly senders = new Map<string, number[]>();
  private readonly sources = new Map<string, number[]>();
  private global: number[] = [];

  constructor(
    private readonly limits: PairingAttemptLimits = PAIRING_ATTEMPT_LIMITS,
    private readonly windowMs: number = PAIRING_ATTEMPT_WINDOW_MS
  ) {}

  /** First exhausted dimension, or `null` while guessing is still allowed. */
  blocked(input: PairingAttemptInput, now = Date.now()): PairingLimit | null {
    if (
      input.codeFingerprint !== null &&
      this.count(this.codes.get(input.codeFingerprint), now) >=
        this.limits.perCode
    ) {
      return "code";
    }
    if (
      this.count(this.senders.get(input.senderKey), now) >=
      this.limits.perSender
    ) {
      return "sender";
    }
    if (
      this.count(this.sources.get(input.sourceKey), now) >=
      this.limits.perSource
    ) {
      return "source";
    }
    return this.count(this.global, now) >= this.limits.global ? "global" : null;
  }

  /** Books one failed guess and reports the dimension it just exhausted. */
  recordFailure(
    input: PairingAttemptInput,
    now = Date.now()
  ): PairingLimit | null {
    if (input.codeFingerprint !== null) {
      this.push(this.codes, input.codeFingerprint, now);
    }
    this.push(this.senders, input.senderKey, now);
    this.push(this.sources, input.sourceKey, now);
    this.global = [...this.global, now].filter(
      (at) => at > now - this.windowMs
    );
    return this.blocked(input, now);
  }

  reset(): void {
    this.codes.clear();
    this.senders.clear();
    this.sources.clear();
    this.global = [];
  }

  private count(times: number[] | undefined, now: number): number {
    if (!times) {
      return 0;
    }
    const cutoff = now - this.windowMs;
    let live = 0;
    for (const at of times) {
      if (at > cutoff) {
        live += 1;
      }
    }
    return live;
  }

  private push(map: Map<string, number[]>, key: string, now: number): void {
    const cutoff = now - this.windowMs;
    const live = map.get(key)?.filter((at) => at > cutoff) ?? [];

    if (live.length === 0 && !map.has(key) && map.size >= MAX_TRACKED_KEYS) {
      this.evictOldest(map);
    }

    map.set(key, [...live, now]);
  }

  /** Drops the least recently seen key; a stale counter is the cheapest to lose. */
  private evictOldest(map: Map<string, number[]>): void {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;

    for (const [key, times] of map) {
      const last = times[times.length - 1] ?? Number.NEGATIVE_INFINITY;
      if (last < oldestAt) {
        oldestAt = last;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      map.delete(oldestKey);
    }
  }
}

const budgets = new Map<string, PairingAttemptBudget>();

export function getPairingAttemptBudget(scope: string): PairingAttemptBudget {
  const existing = budgets.get(scope);
  if (existing) {
    return existing;
  }
  const created = new PairingAttemptBudget();
  budgets.set(scope, created);
  return created;
}

/** Called when an owner issues a fresh code, so a lockout cannot outlive it. */
export function resetPairingAttemptBudget(scope?: string): void {
  if (scope === undefined) {
    budgets.clear();
    return;
  }
  budgets.delete(scope);
}

/** `@internal` Test helper — clears every scope's counters. */
export function resetPairingAttemptBudgetsForTests(): void {
  budgets.clear();
}

/**
 * One message for every rejected attempt. A stranger learns only that the
 * pairing failed, never whether a code existed, expired, or ran out of
 * attempts.
 */
export function pairingFailureMessage(label: string): string {
  return `That pairing code did not work. Generate a new code in this agent’s Connections → ${label} and try again.`;
}
