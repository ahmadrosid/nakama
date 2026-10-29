import { describe, expect, test } from "bun:test";
import {
  LOCAL_CLIENT_EMAIL,
  LOCAL_CLIENT_USER_ID,
} from "@nakama/core/local-auth";
import { createInMemoryDatabaseAdapter } from "./index";
import { ensureLocalClientAccess } from "./local-client";

describe("ensureLocalClientAccess", () => {
  test("creates the local client user and adds it to every org", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertOrganization({
      createdAt: now,
      id: "org_a",
      name: "Org A",
      slug: "org-a",
      updatedAt: now,
    });
    await db.upsertOrganization({
      createdAt: now,
      id: "org_b",
      name: "Org B",
      slug: "org-b",
      updatedAt: now,
    });

    await ensureLocalClientAccess(db);

    const user = await db.getUserByEmail(LOCAL_CLIENT_EMAIL);
    expect(user).not.toBeNull();
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
      createdAt: now,
      id: "org_a",
      name: "Org A",
      slug: "org-a",
      updatedAt: now,
    });

    await ensureLocalClientAccess(db);
    await ensureLocalClientAccess(db);

    expect(await db.countUsers()).toBe(1);
    expect(await db.countHumanUsers()).toBe(0);
  });
});
