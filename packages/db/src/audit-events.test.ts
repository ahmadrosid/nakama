import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  createSqliteDatabaseAdapter,
  createSqliteMemoryAdapter,
} from "./adapters/sqlite";
import { migrateDatabase } from "./migrate";
import { mergeWorkspaceSettings } from "./workspace-settings";

describe("audit events", () => {
  test("stores append-only events and filters them", async () => {
    const adapter = createSqliteMemoryAdapter();

    await adapter.createAuditEvent({
      action: "provider.update",
      actorUserId: "user_admin",
      clientIp: "10.0.0.1",
      createdAt: "2026-09-12T01:00:00.000Z",
      id: "audit_1",
      metadata: { installId: "install_1" },
      orgId: "org_1",
      requestId: "request_1",
      resourceId: "provider_1",
      resourceType: "provider",
    });

    await adapter.createAuditEvent({
      action: "auth.login",
      actorUserId: null,
      createdAt: "2026-09-12T02:00:00.000Z",
      id: "audit_2",
      metadata: {},
      orgId: null,
      requestId: "request_2",
      resourceId: null,
      resourceType: "user",
    });

    await expect(adapter.listAuditEvents({ limit: 1 })).resolves.toEqual({
      events: [
        expect.objectContaining({ action: "auth.login", id: "audit_2" }),
      ],
      total: 2,
    });

    await expect(adapter.listAuditEvents({ orgId: "org_1" })).resolves.toEqual({
      events: [
        {
          action: "provider.update",
          actorMode: null,
          actorUserId: "user_admin",
          clientIp: "10.0.0.1",
          createdAt: "2026-09-12T01:00:00.000Z",
          forwardedFor: null,
          hash: expect.any(String),
          id: "audit_1",
          method: null,
          metadata: { installId: "install_1" },
          orgId: "org_1",
          outcome: "success",
          prevHash: null,
          requestId: "request_1",
          resourceId: "provider_1",
          resourceType: "provider",
          route: null,
          seq: 1,
          sessionId: null,
          status: null,
          userAgent: null,
        },
      ],
      total: 1,
    });
  });

  test("filters by outcome, category, and search", async () => {
    const adapter = createSqliteMemoryAdapter();

    await adapter.createAuditEvent({
      action: "auth.login",
      actorUserId: "user_a",
      clientIp: "203.0.113.9",
      createdAt: "2026-09-12T01:00:00.000Z",
      id: "audit_1",
      orgId: "org_1",
      resourceType: "user",
    });

    await adapter.createAuditEvent({
      action: "skill.create",
      actorUserId: "user_a",
      createdAt: "2026-09-12T02:00:00.000Z",
      id: "audit_2",
      orgId: "org_1",
      resourceId: "skill_1",
      resourceType: "skill",
    });

    await adapter.createAuditEvent({
      action: "skill.create",
      createdAt: "2026-09-12T03:00:00.000Z",
      id: "audit_3",
      orgId: "org_2",
      outcome: "failure",
      resourceType: "skill",
    });

    await expect(
      adapter.listAuditEvents({ orgId: "org_1", outcome: "success" })
    ).resolves.toEqual({
      events: [
        expect.objectContaining({ id: "audit_2" }),
        expect.objectContaining({ id: "audit_1" }),
      ],
      total: 2,
    });

    await expect(
      adapter.listAuditEvents({ category: "skill" })
    ).resolves.toEqual({
      events: [
        expect.objectContaining({ id: "audit_3" }),
        expect.objectContaining({ id: "audit_2" }),
      ],
      total: 2,
    });

    await expect(
      adapter.listAuditEvents({ search: "203.0.113" })
    ).resolves.toEqual({
      events: [expect.objectContaining({ id: "audit_1" })],
      total: 1,
    });

    await expect(
      adapter.listAuditEvents({ search: "user_a" })
    ).resolves.toEqual({
      events: [
        expect.objectContaining({ id: "audit_2" }),
        expect.objectContaining({ id: "audit_1" }),
      ],
      total: 2,
    });
  });

  test("chains events and verifies integrity", async () => {
    const adapter = createSqliteMemoryAdapter();

    for (let index = 1; index <= 3; index += 1) {
      await adapter.createAuditEvent({
        action: "auth.login",
        createdAt: `2026-09-12T0${index}:00:00.000Z`,
        id: `audit_${index}`,
        orgId: "org_1",
        resourceType: "user",
      });
    }

    const listed = await adapter.listAuditEvents();

    expect(listed.total).toBe(3);
    expect(listed.events.map((event) => event.seq)).toEqual([3, 2, 1]);
    expect(listed.events[2]!.prevHash).toBe(null);

    for (let index = 0; index < 2; index += 1) {
      expect(listed.events[index]!.prevHash).toBe(
        listed.events[index + 1]!.hash
      );
    }

    await expect(adapter.verifyAuditChain()).resolves.toEqual({
      brokenId: null,
      brokenSeq: null,
      checked: 3,
      legacy: 0,
      ok: true,
      reason: null,
    });
  });

  test("the verifier detects forged rows", async () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    const insert = database.prepare(`
      INSERT INTO audit_events (
        id, action, resource_type, metadata, created_at,
        seq, prev_hash, hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Row 1 stores a hash that does not match its columns.
    insert.run(
      "audit_1",
      "auth.login",
      "user",
      "{}",
      "2026-09-12T01:00:00.000Z",
      1,
      "",
      "deadbeef"
    );
    // Row 2 links to row 1's stored hash, so only row 1 is broken.
    insert.run(
      "audit_2",
      "auth.login",
      "user",
      "{}",
      "2026-09-12T02:00:00.000Z",
      2,
      "deadbeef",
      "feedface"
    );

    const adapter = createSqliteDatabaseAdapter(database);
    // SAFETY: the adapter owns the handle; the test only seeds rows directly.

    await expect(adapter.verifyAuditChain()).resolves.toEqual({
      brokenId: "audit_1",
      brokenSeq: 1,
      checked: 0,
      legacy: 0,
      ok: false,
      reason: "stored hash does not match recomputed hash",
    });
  });

  test("upgrades an audit_events table created before the chain columns", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY NOT NULL,
        actor_user_id TEXT,
        org_id TEXT,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        request_id TEXT,
        created_at TEXT NOT NULL
      );
    `);

    migrateDatabase(database);

    const columns = database
      .query<{ name: string }, []>("PRAGMA table_info(audit_events)")
      .all();

    expect(columns.map((column) => column.name)).toContain("seq");
  });

  test("rows written before the chain verify as legacy", async () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    database
      .prepare(
        `INSERT INTO audit_events (id, action, resource_type, metadata, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run("audit_old", "auth.login", "user", "{}", "2026-08-01T00:00:00.000Z");

    const adapter = createSqliteDatabaseAdapter(database);
    // SAFETY: the adapter owns the handle; the test only seeds rows directly.

    await adapter.createAuditEvent({
      action: "skill.create",
      createdAt: "2026-09-12T01:00:00.000Z",
      id: "audit_new",
      resourceType: "skill",
    });

    await expect(adapter.verifyAuditChain()).resolves.toEqual({
      brokenId: null,
      brokenSeq: null,
      checked: 1,
      legacy: 1,
      ok: true,
      reason: null,
    });
  });

  test("prunes rows past retention, records the prune, and keeps the chain verifiable", async () => {
    const database = new Database(":memory:");
    migrateDatabase(database);
    const adapter = createSqliteDatabaseAdapter(database);
    const now = new Date().toISOString();

    // The 1000th append triggers the prune.
    for (let index = 1; index <= 1000; index += 1) {
      await adapter.createAuditEvent({
        action: "tool.call",
        createdAt: index <= 400 ? "2020-01-01T00:00:00.000Z" : now,
        id: `audit_${index}`,
        resourceType: "tool",
      });
    }

    const rows = (await Array.fromAsync(adapter.exportAuditEvents())).flat();

    expect(rows).toHaveLength(601);
    expect(rows[0]?.seq).toBe(401);
    expect(rows.filter((row) => row.action === "audit.prune")).toHaveLength(1);

    // 601 rows span two verify pages, so a timer queued now runs mid-verify.
    let yielded = false;
    setImmediate(() => {
      yielded = true;
    });

    await expect(adapter.verifyAuditChain()).resolves.toMatchObject({
      checked: 601,
      ok: true,
    });

    expect(yielded).toBe(true);

    expect(() =>
      database.exec("DELETE FROM audit_events WHERE id = 'audit_401'")
    ).toThrow();
  });

  test("prunes a large backlog one bounded chunk at a time", async () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    // 2500 expired pre-chain rows plus 1000 expired appends: 3499 prunable.
    const insertLegacy = database.prepare(
      `INSERT INTO audit_events (id, action, resource_type, metadata, created_at)
       VALUES (?, 'tool.call', 'tool', '{}', '2020-01-01T00:00:00.000Z')`
    );

    for (let index = 1; index <= 2500; index += 1) {
      insertLegacy.run(`audit_legacy_${index}`);
    }

    const adapter = createSqliteDatabaseAdapter(database);

    for (let index = 1; index <= 1000; index += 1) {
      await adapter.createAuditEvent({
        action: "tool.call",
        createdAt: "2020-01-01T00:00:00.000Z",
        id: `audit_${index}`,
        resourceType: "tool",
      });
    }

    const prune = database
      .query<{ deleted: number }, []>(
        "SELECT json_extract(metadata, '$.deleted') AS deleted FROM audit_events WHERE action = 'audit.prune'"
      )
      .get();

    expect(prune?.deleted).toBe(2000);
    expect(
      database.query("SELECT count(*) AS count FROM audit_events").get()
    ).toEqual({ count: 1501 });

    await expect(adapter.verifyAuditChain()).resolves.toMatchObject({
      ok: true,
    });
  });

  test("flags old rows deleted without a recorded prune", async () => {
    const database = new Database(":memory:");
    migrateDatabase(database);
    const adapter = createSqliteDatabaseAdapter(database);

    for (const [index, createdAt] of [
      "2020-01-01T00:00:00.000Z",
      "2020-01-02T00:00:00.000Z",
      new Date().toISOString(),
    ].entries()) {
      await adapter.createAuditEvent({
        action: "auth.login",
        createdAt,
        id: `audit_${index + 1}`,
        resourceType: "user",
      });
    }

    database.exec("DELETE FROM audit_events WHERE seq = 1");

    await expect(adapter.verifyAuditChain()).resolves.toMatchObject({
      brokenSeq: 2,
      ok: false,
    });
  });

  test("counts and manually prunes rows using configured retention days", async () => {
    const database = new Database(":memory:");
    migrateDatabase(database);
    const adapter = createSqliteDatabaseAdapter(database);

    const dayMs = 24 * 60 * 60 * 1000;

    const daysAgo = (days: number) =>
      new Date(Date.now() - days * dayMs).toISOString();

    await adapter.createAuditEvent({
      action: "auth.login",
      createdAt: daysAgo(60),
      id: "audit_60d",
      resourceType: "user",
    });
    await adapter.createAuditEvent({
      action: "auth.login",
      createdAt: daysAgo(45),
      id: "audit_45d",
      resourceType: "user",
    });
    await adapter.createAuditEvent({
      action: "auth.login",
      createdAt: daysAgo(10),
      id: "audit_10d",
      resourceType: "user",
    });

    // Under default 365-day retention, nothing is prunable and trigger blocks delete.
    await expect(adapter.countPrunableAuditEvents()).resolves.toEqual({
      days: 365,
      rows: 0,
    });
    await expect(adapter.countPrunableAuditEvents(30)).resolves.toEqual({
      days: 30,
      rows: 2,
    });
    expect(() =>
      database.exec("DELETE FROM audit_events WHERE id = 'audit_60d'")
    ).toThrow();

    // Update retention to 30 days and prune manually.
    await adapter.upsertWorkspaceSettings(
      mergeWorkspaceSettings(await adapter.getWorkspaceSettings(), {
        auditRetentionDays: 30,
      })
    );

    const result = await adapter.pruneAuditEvents({
      actorMode: "session",
      actorUserId: "user_admin",
      method: "POST",
      route: "/v1/platform/audit-events/prune",
    });

    expect(result).toEqual({
      deleted: 2,
      hasMore: false,
      retentionDays: 30,
    });
    await expect(adapter.countPrunableAuditEvents()).resolves.toEqual({
      days: 30,
      rows: 0,
    });
    await expect(adapter.verifyAuditChain()).resolves.toMatchObject({
      checked: 2,
      ok: true,
    });
  });

  test("retention 0 disables pruning and blocks all deletes", async () => {
    const database = new Database(":memory:");
    migrateDatabase(database);
    const adapter = createSqliteDatabaseAdapter(database);

    await adapter.createAuditEvent({
      action: "auth.login",
      createdAt: "2020-01-01T00:00:00.000Z",
      id: "audit_old_1",
      resourceType: "user",
    });
    await adapter.createAuditEvent({
      action: "auth.login",
      createdAt: new Date().toISOString(),
      id: "audit_new_2",
      resourceType: "user",
    });

    await adapter.upsertWorkspaceSettings(
      mergeWorkspaceSettings(await adapter.getWorkspaceSettings(), {
        auditRetentionDays: 0,
      })
    );

    await expect(adapter.countPrunableAuditEvents()).resolves.toEqual({
      days: 0,
      rows: 0,
    });
    await expect(adapter.pruneAuditEvents()).resolves.toEqual({
      deleted: 0,
      hasMore: false,
      retentionDays: 0,
    });
    expect(() =>
      database.exec("DELETE FROM audit_events WHERE id = 'audit_old_1'")
    ).toThrow();
  });
});
