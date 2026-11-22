import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  createSqliteDatabaseAdapter,
  createSqliteMemoryAdapter,
} from "./adapters/sqlite";
import { migrateDatabase } from "./migrate";

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
});
