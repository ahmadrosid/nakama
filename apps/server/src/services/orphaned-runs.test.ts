import { afterEach, beforeEach, expect, test } from "bun:test";
import { type CrashReport, setCrashLogger } from "@nakama/core/crash-report";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { reconcileOrphanedAutomationRuns } from "./orphaned-runs";

let reports: CrashReport[] = [];

beforeEach(() => {
  reports = [];
  setCrashLogger((report) => {
    reports.push(report);
  });
});

afterEach(() => {
  setCrashLogger(null);
});

async function seedAutomation(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>,
  id: string
): Promise<void> {
  const now = new Date().toISOString();

  await db.upsertAutomation({
    createdAt: now,
    enabled: true,
    id,
    name: id,
    orgId: "org_a",
    profileId: "prof_a",
    prompt: "do the thing",
    trigger: { type: "manual" },
    updatedAt: now,
  } as any);
}

async function seedRun(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>,
  automationId: string,
  runId: string,
  startedAt: string,
  status: "running" | "completed" = "running"
): Promise<void> {
  await db.insertAutomationRun({
    automationId,
    completedAt: status === "completed" ? startedAt : null,
    error: null,
    id: runId,
    output: null,
    startedAt,
    status,
  });
}

test("a run left running by a previous process is reported and closed out", async () => {
  const db = createInMemoryDatabaseAdapter();
  await seedAutomation(db, "auto_a");
  await seedRun(db, "auto_a", "run_old", "2026-08-07T00:00:00.000Z");

  const bootedAt = Date.parse("2026-08-07T01:00:00.000Z");
  const orphaned = await reconcileOrphanedAutomationRuns(db, bootedAt);

  expect(orphaned.map((run) => run.id)).toEqual(["run_old"]);
  expect(reports).toHaveLength(1);
  expect(reports[0]?.kind).toBe("invariant");
  expect(reports[0]?.message).toContain("left unfinished");

  const runs = await db.listAutomationRuns("auto_a");
  expect(runs[0]?.status).toBe("failed");
  expect(runs[0]?.completedAt).toBeTruthy();
});

test("a run started by this process is left alone", async () => {
  const db = createInMemoryDatabaseAdapter();
  await seedAutomation(db, "auto_a");
  await seedRun(db, "auto_a", "run_live", "2026-08-07T02:00:00.000Z");

  const bootedAt = Date.parse("2026-08-07T01:00:00.000Z");
  const orphaned = await reconcileOrphanedAutomationRuns(db, bootedAt);

  expect(orphaned).toHaveLength(0);
  expect(reports).toHaveLength(0);
  expect((await db.listAutomationRuns("auto_a"))[0]?.status).toBe("running");
});

test("a clean install reports nothing", async () => {
  const db = createInMemoryDatabaseAdapter();
  await seedAutomation(db, "auto_a");
  await seedRun(
    db,
    "auto_a",
    "run_done",
    "2026-08-07T00:00:00.000Z",
    "completed"
  );

  expect(await reconcileOrphanedAutomationRuns(db, Date.now())).toHaveLength(0);
  expect(reports).toHaveLength(0);
});

test("the second boot stays quiet, so this cannot become permanent noise", async () => {
  const db = createInMemoryDatabaseAdapter();
  await seedAutomation(db, "auto_a");
  await seedRun(db, "auto_a", "run_old", "2026-08-07T00:00:00.000Z");

  const bootedAt = Date.parse("2026-08-07T01:00:00.000Z");
  await reconcileOrphanedAutomationRuns(db, bootedAt);
  reports = [];

  expect(await reconcileOrphanedAutomationRuns(db, bootedAt)).toHaveLength(0);
  expect(reports).toHaveLength(0);
});

test("orphans across several automations are reported once, not once each", async () => {
  const db = createInMemoryDatabaseAdapter();
  await seedAutomation(db, "auto_a");
  await seedAutomation(db, "auto_b");
  await seedRun(db, "auto_a", "run_a", "2026-08-07T00:00:00.000Z");
  await seedRun(db, "auto_b", "run_b", "2026-08-07T00:10:00.000Z");

  const orphaned = await reconcileOrphanedAutomationRuns(
    db,
    Date.parse("2026-08-07T01:00:00.000Z")
  );

  expect(orphaned).toHaveLength(2);
  expect(reports).toHaveLength(1);
});
