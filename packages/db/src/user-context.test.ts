import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USER_CONTEXT_TEMPLATE } from "@nakama/core";
import { createInMemoryDatabaseAdapter, createSqliteDatabase } from "./index";

describe("user context storage", () => {
  test("init creates context and second init is a no-op", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = "2026-06-21T10:00:00.000Z";

    await db.createUser({
      createdAt: now,
      email: "alice@example.com",
      id: "user_1",
      isPlatformAdmin: false,
      passwordHash: "hash",
      updatedAt: now,
    });

    await db.upsertOrganization({
      createdAt: now,
      id: "org_1",
      name: "Acme",
      slug: "acme",
      updatedAt: now,
    });
    await db.upsertOrgMember({
      createdAt: now,
      orgId: "org_1",
      role: "admin",
      userId: "user_1",
    });

    expect(await db.getUserContext("org_1", "user_1")).toBeNull();

    await db.setUserContext("org_1", "user_1", USER_CONTEXT_TEMPLATE, now);

    await db.setUserContext("org_1", "user_1", "# Updated", now);
    expect(await db.getUserContext("org_1", "user_1")).toBe("# Updated");
  });

  test("stores context separately for the same user in different orgs", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = "2026-06-21T10:00:00.000Z";

    await db.createUser({
      createdAt: now,
      email: "alice@example.com",
      id: "user_1",
      isPlatformAdmin: false,
      passwordHash: "hash",
      updatedAt: now,
    });

    for (const orgId of ["org_1", "org_2"]) {
      await db.upsertOrganization({
        createdAt: now,
        id: orgId,
        name: orgId,
        slug: orgId,
        updatedAt: now,
      });
      await db.upsertOrgMember({
        createdAt: now,
        orgId,
        role: "member",
        userId: "user_1",
      });
    }

    await db.setUserContext(
      "org_1",
      "user_1",
      "# About Me\n\nAlice at Org 1",
      now
    );
    await db.setUserContext(
      "org_2",
      "user_1",
      "# About Me\n\nAlice at Org 2",
      now
    );

    expect(await db.getUserContext("org_1", "user_1")).toBe(
      "# About Me\n\nAlice at Org 1"
    );
    expect(await db.getUserContext("org_2", "user_1")).toBe(
      "# About Me\n\nAlice at Org 2"
    );
  });

  test("migrates legacy users.user_context into org_members on open", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nakama-user-context-"));
    const databasePath = join(dir, "test.db");

    try {
      const database = await createSqliteDatabase(`file:${databasePath}`);
      const now = "2026-06-21T10:00:00.000Z";

      await database.adapter.createUser({
        createdAt: now,
        email: "alice@example.com",
        id: "user_1",
        isPlatformAdmin: false,
        passwordHash: "hash",
        updatedAt: now,
      });
      await database.adapter.upsertOrganization({
        createdAt: now,
        id: "org_1",
        name: "Acme",
        slug: "acme",
        updatedAt: now,
      });
      await database.adapter.upsertOrgMember({
        createdAt: now,
        orgId: "org_1",
        role: "admin",
        userId: "user_1",
      });
      database.close();

      const raw = new Database(databasePath);
      raw.run("UPDATE users SET user_context = ? WHERE id = ?", [
        "# Legacy user-level context",
        "user_1",
      ]);
      raw.close();

      const reopened = await createSqliteDatabase(`file:${databasePath}`);
      expect(await reopened.adapter.getUserContext("org_1", "user_1")).toBe(
        "# Legacy user-level context"
      );
      reopened.close();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("does not prefer users.user_context over org_members", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nakama-user-context-"));
    const databasePath = join(dir, "test.db");

    try {
      const database = await createSqliteDatabase(`file:${databasePath}`);
      const now = "2026-06-21T10:00:00.000Z";

      await database.adapter.createUser({
        createdAt: now,
        email: "bob@example.com",
        id: "user_2",
        isPlatformAdmin: false,
        passwordHash: "hash",
        updatedAt: now,
      });
      await database.adapter.upsertOrganization({
        createdAt: now,
        id: "org_2",
        name: "Beta",
        slug: "beta",
        updatedAt: now,
      });
      await database.adapter.upsertOrgMember({
        createdAt: now,
        orgId: "org_2",
        role: "member",
        userId: "user_2",
      });
      await database.adapter.setUserContext(
        "org_2",
        "user_2",
        "# Org scoped",
        now
      );
      database.close();

      const raw = new Database(databasePath);
      raw.run("UPDATE users SET user_context = ? WHERE id = ?", [
        "# Legacy should lose",
        "user_2",
      ]);
      raw.close();

      const reopened = await createSqliteDatabase(`file:${databasePath}`);
      expect(await reopened.adapter.getUserContext("org_2", "user_2")).toBe(
        "# Org scoped"
      );
      reopened.close();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
