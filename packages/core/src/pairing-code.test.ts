import { describe, expect, test } from "bun:test";
import {
  createPairingCodeSecret,
  fingerprintPairingCode,
  generatePairingCode,
  getPairingAttemptBudget,
  isPairingCodeActive,
  looksLikePairingCode,
  normalizePairingCode,
  PAIRING_ATTEMPT_LIMITS,
  PAIRING_ATTEMPT_WINDOW_MS,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  PairingAttemptBudget,
  type PairingAttemptInput,
  pairingCodesMatch,
  resetPairingAttemptBudgetsForTests,
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

describe("fingerprintPairingCode", () => {
  test("is stable across formatting and never echoes the code", () => {
    const code = generatePairingCode();

    expect(fingerprintPairingCode(code.toLowerCase())).toBe(
      fingerprintPairingCode(code)
    );
    expect(fingerprintPairingCode(code)).not.toContain(code);
  });
});

function attempt(
  overrides: Partial<PairingAttemptInput> = {}
): PairingAttemptInput {
  return {
    codeFingerprint: fingerprintPairingCode(generatePairingCode()),
    senderKey: "U1",
    sourceKey: "test-network",
    ...overrides,
  };
}

describe("PairingAttemptBudget", () => {
  test("blocks nothing before the first failure", () => {
    expect(new PairingAttemptBudget().blocked(attempt())).toBeNull();
  });

  test("exhausts the per-code budget and retires that code only", () => {
    const budget = new PairingAttemptBudget();
    const code = fingerprintPairingCode(generatePairingCode());

    for (let i = 0; i < PAIRING_ATTEMPT_LIMITS.perCode - 1; i += 1) {
      expect(budget.recordFailure(attempt({ codeFingerprint: code }))).toBe(
        null
      );
    }
    expect(budget.blocked(attempt({ codeFingerprint: code }))).toBeNull();

    expect(budget.recordFailure(attempt({ codeFingerprint: code }))).toBe(
      "code"
    );
    expect(budget.blocked(attempt({ codeFingerprint: code }))).toBe("code");
    expect(
      budget.blocked(attempt({ codeFingerprint: fingerprintPairingCode("x") }))
    ).toBeNull();
  });

  test("exhausts the per-sender budget for one identity", () => {
    const budget = new PairingAttemptBudget();
    let exhausted: string | null = null;

    for (let i = 0; i < PAIRING_ATTEMPT_LIMITS.perSender; i += 1) {
      exhausted = budget.recordFailure(attempt({ senderKey: "U1" }));
    }

    expect(exhausted).toBe("sender");
    expect(budget.blocked(attempt({ senderKey: "U1" }))).toBe("sender");
    expect(budget.blocked(attempt({ senderKey: "U2" }))).toBeNull();
  });

  test("exhausts the per-source budget across senders", () => {
    const budget = new PairingAttemptBudget();
    let exhausted: string | null = null;

    for (let i = 0; i < PAIRING_ATTEMPT_LIMITS.perSource; i += 1) {
      exhausted = budget.recordFailure(
        attempt({ senderKey: `U${i}`, sourceKey: "203.0.113.7" })
      );
    }

    expect(exhausted).toBe("source");
    expect(
      budget.blocked(attempt({ senderKey: "U999", sourceKey: "203.0.113.7" }))
    ).toBe("source");
    expect(
      budget.blocked(attempt({ senderKey: "U999", sourceKey: "198.51.100.4" }))
    ).toBeNull();
  });

  test("exhausts the global budget across codes, senders, and sources", () => {
    const budget = new PairingAttemptBudget();
    let exhausted: string | null = null;

    for (let i = 0; i < PAIRING_ATTEMPT_LIMITS.global; i += 1) {
      exhausted = budget.recordFailure(
        attempt({
          codeFingerprint: fingerprintPairingCode(`code-${i}`),
          senderKey: `U${i}`,
          sourceKey: `198.51.100.${i}`,
        })
      );
    }

    expect(exhausted).toBe("global");
    expect(
      budget.blocked(
        attempt({
          codeFingerprint: fingerprintPairingCode("fresh"),
          senderKey: "U-fresh",
          sourceKey: "198.51.100.250",
        })
      )
    ).toBe("global");
  });

  test("forgets failures once the window has passed", () => {
    const budget = new PairingAttemptBudget();
    const now = Date.now();
    const stale = attempt({ codeFingerprint: null, senderKey: "U1" });

    for (let i = 0; i < PAIRING_ATTEMPT_LIMITS.perSender; i += 1) {
      budget.recordFailure(stale, now);
    }
    expect(budget.blocked(stale, now)).toBe("sender");

    const later = now + PAIRING_ATTEMPT_WINDOW_MS + 1;
    expect(budget.blocked(stale, later)).toBeNull();
  });

  test("reset clears every dimension", () => {
    const budget = new PairingAttemptBudget();
    const code = fingerprintPairingCode(generatePairingCode());

    for (let i = 0; i < PAIRING_ATTEMPT_LIMITS.perCode; i += 1) {
      budget.recordFailure(attempt({ codeFingerprint: code }));
    }
    expect(budget.blocked(attempt({ codeFingerprint: code }))).toBe("code");

    budget.reset();

    expect(budget.blocked(attempt({ codeFingerprint: code }))).toBeNull();
  });
});

describe("getPairingAttemptBudget", () => {
  test("keeps one budget per scope and forgets it on reset", () => {
    resetPairingAttemptBudgetsForTests();
    const code = fingerprintPairingCode(generatePairingCode());
    const scope = "/tmp/nakama-test-scope";

    for (let i = 0; i < PAIRING_ATTEMPT_LIMITS.perCode; i += 1) {
      getPairingAttemptBudget(scope).recordFailure(
        attempt({ codeFingerprint: code })
      );
    }

    expect(getPairingAttemptBudget(scope).blocked(attempt())).toBeNull();
    expect(
      getPairingAttemptBudget(scope).blocked(attempt({ codeFingerprint: code }))
    ).toBe("code");
    expect(
      getPairingAttemptBudget("/tmp/other-scope").blocked(
        attempt({ codeFingerprint: code })
      )
    ).toBeNull();

    getPairingAttemptBudget(scope).reset();

    expect(
      getPairingAttemptBudget(scope).blocked(attempt({ codeFingerprint: code }))
    ).toBeNull();
    resetPairingAttemptBudgetsForTests();
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
