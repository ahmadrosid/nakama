import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "./index";
import type { StoredRegressionCaseRecord } from "./types";

function record(
  overrides: Partial<StoredRegressionCaseRecord> = {}
): StoredRegressionCaseRecord {
  return {
    createdAt: "2026-11-03T09:00:00.000Z",
    createdByUserId: "user_1",
    expectedResult: "Answers with the rollback command.",
    id: "regcase_1",
    input: "How do I roll back a deploy?",
    orgId: "org_1",
    profileId: "agent_1",
    sourceAutomationId: null,
    sourceId: "session_1",
    sourceType: "session",
    ...overrides,
  };
}

describe("regression cases", () => {
  test("round trips a case scoped to its org and profile", async () => {
    const db = createInMemoryDatabaseAdapter();
    const saved = record();

    await db.createRegressionCase(saved);

    expect(await db.getRegressionCase("org_1", "agent_1", saved.id)).toEqual(
      saved
    );
    expect(await db.getRegressionCase("org_2", "agent_1", saved.id)).toBeNull();
    expect(await db.getRegressionCase("org_1", "agent_2", saved.id)).toBeNull();
    expect(await db.listRegressionCasesForProfile("org_1", "agent_1")).toEqual([
      saved,
    ]);
    expect(await db.listRegressionCasesForProfile("org_2", "agent_1")).toEqual(
      []
    );
  });

  test("stores an automation run source and lists newest first", async () => {
    const db = createInMemoryDatabaseAdapter();

    const older = record({
      createdAt: "2026-11-03T09:00:00.000Z",
      id: "regcase_old",
    });

    const newer = record({
      createdAt: "2026-11-03T10:00:00.000Z",
      id: "regcase_new",
      sourceAutomationId: "automation_1",
      sourceId: "run_1",
      sourceType: "automation_run",
    });

    await db.createRegressionCase(older);
    await db.createRegressionCase(newer);

    const cases = await db.listRegressionCasesForProfile("org_1", "agent_1");

    expect(cases.map((item) => item.id)).toEqual([
      "regcase_new",
      "regcase_old",
    ]);
    expect(cases[0]?.sourceAutomationId).toBe("automation_1");
  });
});
