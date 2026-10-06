import { describe, expect, test } from "bun:test";
import {
  createPairingCodeSecret,
  generatePairingCode,
  getPairingAttemptBudget,
  isPairingAttemptBlocked,
  isPairingCodeActive,
  looksLikePairingCode,
  normalizePairingCode,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  pairingCodesMatch,
  recordPairingFailure,
} from "./pairing-code";

describe("generatePairingCode", () => {
  test("carries 128 bits of entropy as 32 hex chars", () => {
    const code = generatePairingCode();

    expect(code).toMatch(/^[0-9A-F]{32}$/);
    expect(code).toHaveLength(PAIRING_CODE_LENGTH);
    expect(new Set([...Array(50)].map(generatePairingCode)).size).toBe(50);
  });
});

describe("normalizePairingCode", () => {
  test("accepts pasted lowercase, spaced, and dash-grouped codes", () => {
    const code = generatePairingCode();

    expect(normalizePairingCode(` ${code.toLowerCase()} `)).toBe(code);
    expect(normalizePairingCode(code.match(/.{8}/gu)!.join("-"))).toBe(code);
    expect(normalizePairingCode(code.match(/.{4}/gu)!.join(" "))).toBe(code);
  });
});

describe("looksLikePairingCode", () => {
  test("only accepts a full code, not a prefix or prose", () => {
    const code = generatePairingCode();

    expect(looksLikePairingCode(code)).toBe(true);
    expect(looksLikePairingCode(`hello ${code}`)).toBe(false);
    expect(looksLikePairingCode(code.slice(0, -1))).toBe(false);
    expect(looksLikePairingCode(`${code}0`)).toBe(false);
  });
});

describe("pairingCodesMatch", () => {
  test("compares regardless of formatting and rejects any difference", () => {
    const code = generatePairingCode();
    const grouped = code.match(/.{8}/gu)!.join(" ");

    expect(pairingCodesMatch(grouped.toLowerCase(), code)).toBe(true);
    expect(pairingCodesMatch(`${code.slice(0, -1)}F`, code)).toBe(
      code.endsWith("F")
    );
    expect(pairingCodesMatch(code.slice(0, 31), code)).toBe(false);
  });
});

describe("isPairingCodeActive", () => {
  const code = generatePairingCode();

  test("is live until its own expiry and dead afterwards", () => {
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString();

    expect(isPairingCodeActive(code, expiresAt)).toBe(true);
    expect(
      isPairingCodeActive(code, new Date(Date.now() - 1).toISOString())
    ).toBe(false);
  });

  test("treats a code with no recorded expiry as expired", () => {
    expect(isPairingCodeActive(code, null)).toBe(false);
    expect(isPairingCodeActive(code, "not-a-date")).toBe(false);
    expect(isPairingCodeActive(null, new Date().toISOString())).toBe(false);
  });
});

describe("getPairingAttemptBudget", () => {
  test("retires one code after five wrong guesses", () => {
    const scope = `scope-${crypto.randomUUID()}`;
    const budget = getPairingAttemptBudget(scope, "A".repeat(32));

    for (let i = 0; i < 4; i += 1) {
      expect(recordPairingFailure(budget)).toBe(false);
    }
    expect(recordPairingFailure(budget)).toBe(true);
    expect(isPairingAttemptBlocked(budget)).toBe(true);
  });

  test("starts a new budget when another process issues a new code", () => {
    const scope = `scope-${crypto.randomUUID()}`;
    const old = getPairingAttemptBudget(scope, "A".repeat(32));
    for (let i = 0; i < 5; i += 1) {
      recordPairingFailure(old);
    }

    const fresh = getPairingAttemptBudget(scope, "B".repeat(32));
    expect(isPairingAttemptBlocked(fresh)).toBe(false);
    expect(fresh).toBe(getPairingAttemptBudget(scope, "B".repeat(32)));
  });
});

describe("createPairingCodeSecret", () => {
  test("mints a live code whose expiry is the TTL out", () => {
    const now = Date.now();
    const secret = createPairingCodeSecret(now);

    expect(secret.code).toMatch(/^[0-9A-F]{32}$/);
    expect(Date.parse(secret.expiresAt) - now).toBe(PAIRING_CODE_TTL_MS);
    expect(isPairingCodeActive(secret.code, secret.expiresAt, now)).toBe(true);
    expect(
      isPairingCodeActive(
        secret.code,
        secret.expiresAt,
        now + PAIRING_CODE_TTL_MS
      )
    ).toBe(false);
  });
});
