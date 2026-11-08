import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDatabase } from "./adapters/sqlite";
import { migrateDatabase } from "./migrate";

const DAY_MS = 24 * 60 * 60 * 1000;

const T0 = Date.parse("2026-01-01T00:00:00.000Z");

async function withDatabase(
  run: (context: {
    db: Awaited<ReturnType<typeof createSqliteDatabase>>["adapter"];
    raw: Database;
    seedAutomation: () => Promise<void>;
  }) => Promise<void>
) {
  const root = await mkdtemp(join(tmpdir(), "automation-webhook-"));
  const filename = join(root, "nakama.sqlite");
  const database = await createSqliteDatabase(`file:${filename}`);
  const raw = new Database(filename);
  const now = new Date(T0).toISOString();

  try {
    raw.exec(
      "INSERT INTO organizations (id,name,slug,created_at,updated_at) VALUES ('o','Org','o','now','now')"
    );
    raw.exec(
      "INSERT INTO profiles (id,name,org_id,created_at,updated_at) VALUES ('p','Profile','o','now','now')"
    );

    await run({
      db: database.adapter,
      raw,
      seedAutomation: () =>
        database.adapter.upsertAutomation({
          createdAt: now,
          definition: { trigger: { type: "webhook" } },
          enabled: true,
          id: "auto_a",
          name: "Auto",
          orgId: "o",
          profileId: "p",
          updatedAt: now,
          version: 1,
        }),
    });
  } finally {
    raw.close();
    database.close();
    await rm(root, { force: true, recursive: true });
  }
}

describe("automation webhook deliveries", () => {
  test("claims once, prunes past the replay window, and cascades on delete", async () => {
    await withDatabase(async ({ db, seedAutomation }) => {
      const at = (days: number) => new Date(T0 + days * DAY_MS).toISOString();

      await seedAutomation();

      expect(
        await db.claimAutomationWebhookDelivery("auto_a", "d1", at(0))
      ).toBe(true);
      expect(
        await db.claimAutomationWebhookDelivery("auto_a", "d1", at(1))
      ).toBe(false);

      // The first claim is now older than the replay window and is pruned.
      expect(
        await db.claimAutomationWebhookDelivery("auto_a", "d2", at(8))
      ).toBe(true);
      expect(
        await db.claimAutomationWebhookDelivery("auto_a", "d1", at(8))
      ).toBe(true);

      await db.releaseAutomationWebhookDelivery("auto_a", "d1");
      expect(
        await db.claimAutomationWebhookDelivery("auto_a", "d1", at(8))
      ).toBe(true);

      expect(await db.deleteAutomation("auto_a")).toBe(true);
      await seedAutomation();
      expect(
        await db.claimAutomationWebhookDelivery("auto_a", "d1", at(8))
      ).toBe(true);
    });
  });

  test("a finished webhook run drops its input and keeps its source", async () => {
    await withDatabase(async ({ db, raw, seedAutomation }) => {
      const startedAt = new Date(T0).toISOString();
      await seedAutomation();

      const run = {
        automationId: "auto_a",
        completedAt: null,
        error: null,
        input: '{"secret":"repo data"}',
        output: null,
        source: "webhook" as const,
        startedAt,
        status: "running" as const,
      };

      await db.insertAutomationRun({ ...run, id: "run_done" });
      await db.insertAutomationRun({ ...run, id: "run_exhausted" });

      const stored = (id: string) =>
        raw
          .query("SELECT input, source FROM automation_runs WHERE id = ?")
          .get(id);

      // A resumed run still has its input while it runs.
      expect(
        (await db.claimInterruptedAutomationRuns(2)).map((r) => r.input)
      ).toEqual([run.input, run.input]);

      await db.updateAutomationRun({
        ...run,
        completedAt: startedAt,
        id: "run_done",
        output: "ok",
        status: "completed",
      });
      expect(stored("run_done")).toEqual({ input: null, source: "webhook" });

      // Runs that used up their resumes fail and lose their input too.
      expect(await db.claimInterruptedAutomationRuns(1)).toEqual([]);
      expect(stored("run_exhausted")).toEqual({
        input: null,
        source: "webhook",
      });
    });
  });
});

describe("automation webhook upgrade", () => {
  test("an old database gains the deliveries table and run columns", () => {
    const db = new Database(":memory:");

    try {
      migrateDatabase(db);
      db.exec("DROP TABLE automation_webhook_deliveries");
      db.exec("ALTER TABLE automation_runs DROP COLUMN source");
      db.exec("ALTER TABLE automation_runs DROP COLUMN input");

      migrateDatabase(db);

      const columns = db
        .query<{ name: string }, []>("PRAGMA table_info(automation_runs)")
        .all()
        .map((column) => column.name);

      expect(columns).toContain("source");
      expect(columns).toContain("input");
      expect(
        db
          .query(
            "SELECT name FROM sqlite_master WHERE name = 'automation_webhook_deliveries'"
          )
          .get()
      ).not.toBeNull();
    } finally {
      db.close();
    }
  });
});
