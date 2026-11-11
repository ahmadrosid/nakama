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
    privateToUserId: null,
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
    const saved = record({ privateToUserId: "user_1" });

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

  test("stores an automation run source and pages newest first", async () => {
    const db = createInMemoryDatabaseAdapter();

    const older = record({
      createdAt: "2026-11-03T09:00:00.000Z",
      id: "regcase_old",
    });

    const middle = record({
      createdAt: "2026-11-03T10:00:00.000Z",
      id: "regcase_mid",
    });

    const newer = record({
      createdAt: "2026-11-03T11:00:00.000Z",
      id: "regcase_new",
      sourceAutomationId: "automation_1",
      sourceId: "run_1",
      sourceType: "automation_run",
    });

    await db.createRegressionCase(older);
    await db.createRegressionCase(middle);
    await db.createRegressionCase(newer);

    const first = await db.listRegressionCasesForProfile("org_1", "agent_1", {
      limit: 2,
    });

    expect(first.map((item) => item.id)).toEqual([
      "regcase_new",
      "regcase_mid",
    ]);
    expect(first[0]?.sourceAutomationId).toBe("automation_1");

    const second = await db.listRegressionCasesForProfile("org_1", "agent_1", {
      limit: 2,
      offset: 2,
    });

    expect(second.map((item) => item.id)).toEqual(["regcase_old"]);
  });

  test("reads only the last user message", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = "2026-11-03T09:00:00.000Z";

    await db.upsertSession({
      agentQuestionnaire: null,
      agentTodos: [],
      channel: "web",
      createdAt: now,
      id: "session_1",
      model: null,
      profileId: "agent_1",
      title: null,
      userId: "user_1",
    });

    await db.appendMessagesForSession("session_1", [
      {
        createdAt: now,
        id: "msg_1",
        payload: { content: "First question", role: "user" },
        seq: 0,
        sessionId: "session_1",
      },
      {
        createdAt: now,
        id: "msg_2",
        payload: { content: "First answer", role: "assistant" },
        seq: 1,
        sessionId: "session_1",
      },
      {
        createdAt: now,
        id: "msg_3",
        payload: {
          content: [
            { data: "base64", mediaType: "audio/wav", type: "audio" },
            { text: "Second question", type: "text" },
          ],
          role: "user",
        },
        seq: 2,
        sessionId: "session_1",
      },
      {
        createdAt: now,
        id: "msg_4",
        payload: { content: "Second answer", role: "assistant" },
        seq: 3,
        sessionId: "session_1",
      },
    ]);

    const message = await db.getLastUserMessageForSession("session_1");

    expect(message?.seq).toBe(2);
    expect(await db.getLastUserMessageForSession("missing")).toBeNull();
  });

  test("stores a rerun and saves its mark within the org", async () => {
    const db = createInMemoryDatabaseAdapter();

    await db.createRegressionCase(record());

    const run = {
      caseId: "regcase_1",
      createdAt: "2026-11-11T09:00:00.000Z",
      createdByUserId: "user_1",
      error: null,
      id: "regrun_1",
      orgId: "org_1",
      output: "Run `deploy rollback`.",
      status: "completed" as const,
      verdict: null,
      verdictAt: null,
      verdictByUserId: null,
    };

    await db.createRegressionCaseRun(run);

    expect(
      await db.getRegressionCaseRun("org_1", "regcase_1", "regrun_1")
    ).toEqual(run);
    expect(
      await db.getRegressionCaseRun("org_2", "regcase_1", "regrun_1")
    ).toBeNull();

    const mark = {
      at: "2026-11-11T09:05:00.000Z",
      userId: "user_1",
      verdict: "pass" as const,
    };

    expect(
      await db.setRegressionCaseRunVerdict(
        "org_2",
        "regcase_1",
        "regrun_1",
        mark
      )
    ).toBeNull();

    const marked = {
      ...run,
      verdict: "pass",
      verdictAt: mark.at,
      verdictByUserId: "user_1",
    };

    expect(
      await db.setRegressionCaseRunVerdict(
        "org_1",
        "regcase_1",
        "regrun_1",
        mark
      )
    ).toEqual(marked);
    expect(
      await db.getRegressionCaseRun("org_1", "regcase_1", "regrun_1")
    ).toEqual(marked);
  });
});
