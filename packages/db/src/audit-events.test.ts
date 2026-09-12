import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createSqliteMemoryAdapter } from "./adapters/sqlite";
import { migrateDatabase } from "./migrate";

describe("audit events", () => {
  test("stores append-only events and filters them", async () => {
    const adapter = createSqliteMemoryAdapter();
    await adapter.createAuditEvent({
      action: "provider.update",
      actorUserId: "user_admin",
      createdAt: "2026-09-12T01:00:00.000Z",
      id: "audit_1",
      metadata: { outcome: "success", status: 200 },
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
      metadata: { outcome: "failure", status: 401 },
      orgId: null,
      requestId: "request_2",
      resourceId: null,
      resourceType: "user",
    });

    await expect(adapter.listAuditEvents({ limit: 1 })).resolves.toEqual([
      expect.objectContaining({ action: "auth.login", id: "audit_2" }),
    ]);
    await expect(adapter.listAuditEvents({ orgId: "org_1" })).resolves.toEqual([
      {
        action: "provider.update",
        actorUserId: "user_admin",
        createdAt: "2026-09-12T01:00:00.000Z",
        id: "audit_1",
        metadata: { outcome: "success", status: 200 },
        orgId: "org_1",
        requestId: "request_1",
        resourceId: "provider_1",
        resourceType: "provider",
      },
    ]);
  });

  test("database rejects updates and deletes", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);
    database
      .prepare(`
        INSERT INTO audit_events (
          id, action, resource_type, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        "audit_locked",
        "auth.login",
        "user",
        "{}",
        "2026-09-12T00:00:00.000Z"
      );

    expect(() =>
      database
        .prepare("UPDATE audit_events SET action = ? WHERE id = ?")
        .run("changed", "audit_locked")
    ).toThrow("audit_events are append-only");
    expect(() =>
      database
        .prepare("DELETE FROM audit_events WHERE id = ?")
        .run("audit_locked")
    ).toThrow("audit_events are append-only");
  });
});
