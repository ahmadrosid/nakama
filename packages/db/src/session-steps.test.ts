import { describe, expect, test } from "bun:test";
import { createSqliteMemoryAdapter } from "./adapters/sqlite";
import type { DatabaseAdapter } from "./types";

const ORG_ID = "org_1";

const PROFILE_ID = "profile_1";

async function seedSession(
  db: DatabaseAdapter,
  sessionId = "session_1",
  orgId = ORG_ID
) {
  const now = "2026-01-01T00:00:00.000Z";

  await db.upsertOrganization({
    createdAt: now,
    id: orgId,
    name: orgId,
    slug: orgId,
    updatedAt: now,
  });
  await db.upsertProfile({
    createdAt: now,
    id: PROFILE_ID,
    isDefault: true,
    isSuper: false,
    model: null,
    name: PROFILE_ID,
    orgId,
    systemPrompt: "",
    updatedAt: now,
  });
  await db.upsertSession({
    agentQuestionnaire: null,
    agentTodos: [],
    channel: "web",
    createdAt: now,
    id: sessionId,
    model: null,
    orgId,
    profileId: PROFILE_ID,
    title: null,
  });
}

async function addStep(
  db: DatabaseAdapter,
  sessionId: string,
  toolName: string,
  startedAt: string,
  orgId = ORG_ID
) {
  const saved = await db.appendSessionStep({
    actor: "agent",
    completedAt: startedAt,
    orgId,
    outcome: "success",
    profileId: PROFILE_ID,
    sessionId,
    startedAt,
    toolName,
  });

  expect(saved).toBe(true);
}

describe("session step window", () => {
  test("defaults to the first step and selects the last started at or before a time", async () => {
    const db = createSqliteMemoryAdapter();
    await seedSession(db);
    await addStep(db, "session_1", "first", "2026-01-01T10:00:00.000Z");
    await addStep(db, "session_1", "second", "2026-01-01T11:00:00.000Z");
    await addStep(db, "session_1", "third", "2026-01-01T12:00:00.000Z");

    const initial = await db.getSessionStepWindow(ORG_ID, "session_1");

    expect(initial?.current?.toolName).toBe("first");
    expect(initial?.previous).toBeNull();
    expect(initial?.next?.startedAt).toBe("2026-01-01T11:00:00.000Z");

    const exact = await db.getSessionStepWindow(ORG_ID, "session_1", {
      at: "2026-01-01T11:00:00.000Z",
    });

    expect(exact?.current?.toolName).toBe("second");
    expect(exact?.previous?.startedAt).toBe("2026-01-01T10:00:00.000Z");
    expect(exact?.next?.startedAt).toBe("2026-01-01T12:00:00.000Z");

    const between = await db.getSessionStepWindow(ORG_ID, "session_1", {
      at: "2026-01-01T10:30:00.000Z",
    });

    expect(between?.current?.toolName).toBe("first");

    const after = await db.getSessionStepWindow(ORG_ID, "session_1", {
      at: "2026-01-01T13:00:00.000Z",
    });

    expect(after?.current?.toolName).toBe("third");
    expect(after?.next).toBeNull();
  });

  test("does not select a later step when the time is before the first one", async () => {
    const db = createSqliteMemoryAdapter();
    await seedSession(db);
    await addStep(db, "session_1", "first", "2026-01-01T10:00:00.000Z");
    await addStep(db, "session_1", "second", "2026-01-01T11:00:00.000Z");

    const window = await db.getSessionStepWindow(ORG_ID, "session_1", {
      at: "2026-01-01T09:00:00.000Z",
    });

    expect(window?.current).toBeNull();
    expect(window?.previous).toBeNull();
    expect(window?.next?.startedAt).toBe("2026-01-01T10:00:00.000Z");
  });

  test("breaks a same-start tie by the greatest id", async () => {
    const db = createSqliteMemoryAdapter();
    await seedSession(db);
    await addStep(db, "session_1", "one", "2026-01-01T10:00:00.000Z");
    await addStep(db, "session_1", "two", "2026-01-01T10:00:00.000Z");
    await addStep(db, "session_1", "three", "2026-01-01T10:00:00.000Z");

    const window = await db.getSessionStepWindow(ORG_ID, "session_1", {
      at: "2026-01-01T10:00:00.000Z",
    });

    expect(window?.current?.toolName).toBe("three");
    expect(window?.current?.id).toBe(3);
    expect(window?.next).toBeNull();
    expect(window?.previous?.id).toBe(2);
  });

  test("navigates in start order when it is the reverse of id order", async () => {
    const db = createSqliteMemoryAdapter();
    await seedSession(db);
    await addStep(db, "session_1", "ten", "2026-01-01T10:00:00.000Z");
    await addStep(db, "session_1", "nine", "2026-01-01T09:00:00.000Z");
    await addStep(db, "session_1", "eleven", "2026-01-01T11:00:00.000Z");

    const initial = await db.getSessionStepWindow(ORG_ID, "session_1");

    expect(initial?.current?.toolName).toBe("nine");
    expect(initial?.previous).toBeNull();
    expect(initial?.next?.startedAt).toBe("2026-01-01T10:00:00.000Z");

    const next = await db.getSessionStepWindow(ORG_ID, "session_1", {
      stepId: initial?.next?.id ?? undefined,
    });

    expect(next?.current?.toolName).toBe("ten");
    expect(next?.previous?.startedAt).toBe("2026-01-01T09:00:00.000Z");
    expect(next?.next?.startedAt).toBe("2026-01-01T11:00:00.000Z");

    const later = await db.getSessionStepWindow(ORG_ID, "session_1", {
      stepId: next?.next?.id ?? undefined,
    });

    expect(later?.current?.toolName).toBe("eleven");
    expect(later?.previous?.startedAt).toBe("2026-01-01T10:00:00.000Z");
  });

  test("distinguishes an empty session from a missing or foreign one", async () => {
    const db = createSqliteMemoryAdapter();
    await seedSession(db);

    await expect(db.getSessionStepWindow(ORG_ID, "session_1")).resolves.toEqual(
      { current: null, next: null, previous: null }
    );
    await expect(
      db.getSessionStepWindow(ORG_ID, "missing")
    ).resolves.toBeNull();
    await expect(
      db.getSessionStepWindow("other_org", "session_1")
    ).resolves.toBeNull();
  });

  test("keeps steps after the session moves to another org", async () => {
    const db = createSqliteMemoryAdapter();
    await seedSession(db);
    await addStep(db, "session_1", "kept", "2026-01-01T10:00:00.000Z");

    const now = "2026-01-01T00:00:00.000Z";

    await db.upsertOrganization({
      createdAt: now,
      id: "org_2",
      name: "org_2",
      slug: "org_2",
      updatedAt: now,
    });
    await db.upsertProfile({
      createdAt: now,
      id: "profile_2",
      isDefault: true,
      isSuper: false,
      model: null,
      name: "profile_2",
      orgId: "org_2",
      systemPrompt: "",
      updatedAt: now,
    });
    await db.upsertSession({
      agentQuestionnaire: null,
      agentTodos: [],
      channel: "web",
      createdAt: now,
      id: "session_1",
      model: null,
      orgId: "org_2",
      profileId: "profile_2",
      title: null,
    });

    await expect(
      db.getSessionStepWindow(ORG_ID, "session_1")
    ).resolves.toBeNull();
    await expect(
      db.getSessionStepWindow("org_2", "session_1")
    ).resolves.toMatchObject({ current: { toolName: "kept" } });
  });

  test("reaches steps beyond the old 100 row page", async () => {
    const db = createSqliteMemoryAdapter();
    await seedSession(db);

    for (let index = 1; index <= 120; index++) {
      await addStep(
        db,
        "session_1",
        `tool_${index}`,
        new Date(Date.UTC(2026, 0, 1, 10, 0, 0) + index * 1000).toISOString()
      );
    }

    const fromHundredth = await db.getSessionStepWindow(ORG_ID, "session_1", {
      stepId: 100,
    });

    expect(fromHundredth?.current?.toolName).toBe("tool_100");
    expect(fromHundredth?.next?.id).toBe(101);

    const last = await db.getSessionStepWindow(ORG_ID, "session_1", {
      at: "2026-01-01T10:02:30.000Z",
    });

    expect(last?.current?.id).toBe(120);
    expect(last?.previous?.id).toBe(119);
    expect(last?.next).toBeNull();
  });
});
