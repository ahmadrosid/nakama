import { describe, expect, test } from "bun:test";
import { LOCAL_CLIENT_EMAIL, LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";
import { ensureLocalClientAccess } from "./local-client";

describe("ensureLocalClientAccess", () => {
  test("creates the local client user and adds it to every org", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertOrganization({
      id: "org_a",
      name: "Org A",
      slug: "org-a",
      createdAt: now,
      updatedAt: now,
    });
    await db.upsertOrganization({
      id: "org_b",
      name: "Org B",
      slug: "org-b",
      createdAt: now,
      updatedAt: now,
    });

    await ensureLocalClientAccess(db);

    const user = await db.getUserByEmail(LOCAL_CLIENT_EMAIL);
    expect(user?.id).toBe(LOCAL_CLIENT_USER_ID);
    expect(await db.getOrgMember("org_a", LOCAL_CLIENT_USER_ID)).toMatchObject({
      role: "admin",
    });
    expect(await db.getOrgMember("org_b", LOCAL_CLIENT_USER_ID)).toMatchObject({
      role: "admin",
    });
  });

  test("is idempotent", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertOrganization({
      id: "org_a",
      name: "Org A",
      slug: "org-a",
      createdAt: now,
      updatedAt: now,
    });

    await ensureLocalClientAccess(db);
    await ensureLocalClientAccess(db);

    expect(await db.countUsers()).toBe(1);
    expect(await db.countHumanUsers()).toBe(0);
  });

  test("creates the local client user with a non-placeholder password hash", async () => {
    const db = createInMemoryDatabaseAdapter();

    await ensureLocalClientAccess(db);

    const user = await db.getUserByEmail(LOCAL_CLIENT_EMAIL);
    expect(user?.passwordHash).not.toBe("unused");
    expect(user?.passwordHash.length).toBeGreaterThan(20);
  });

  test("replaces a placeholder password hash with a secure hash", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.createUser({
      id: LOCAL_CLIENT_USER_ID,
      email: LOCAL_CLIENT_EMAIL,
      passwordHash: "unused",
      createdAt: now,
      updatedAt: now,
    });

    await ensureLocalClientAccess(db);

    const user = await db.getUserByEmail(LOCAL_CLIENT_EMAIL);
    expect(user?.passwordHash).not.toBe("unused");
    expect(user?.passwordHash.length).toBeGreaterThan(20);
  });
});
