import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";
import { USER_CONTEXT_TEMPLATE } from "@tinyclaw/core";

describe("user context storage", () => {
  test("init creates context and second init is a no-op", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = "2026-06-21T10:00:00.000Z";

    await db.createUser({
      id: "user_1",
      email: "alice@example.com",
      passwordHash: "hash",
      isPlatformAdmin: false,
      createdAt: now,
      updatedAt: now,
    });

    await db.upsertOrganization({
      id: "org_1",
      name: "Acme",
      slug: "acme",
      createdAt: now,
      updatedAt: now,
    });
    await db.upsertOrgMember({
      orgId: "org_1",
      userId: "user_1",
      role: "admin",
      createdAt: now,
    });

    expect(await db.getUserContext("org_1", "user_1")).toBeNull();

    await db.setUserContext("org_1", "user_1", USER_CONTEXT_TEMPLATE, now);
    expect(await db.getUserContext("org_1", "user_1")).toBe(USER_CONTEXT_TEMPLATE);

    await db.setUserContext("org_1", "user_1", "# Updated", now);
    expect(await db.getUserContext("org_1", "user_1")).toBe("# Updated");
  });

  test("stores context separately for the same user in different orgs", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = "2026-06-21T10:00:00.000Z";

    await db.createUser({
      id: "user_1",
      email: "alice@example.com",
      passwordHash: "hash",
      isPlatformAdmin: false,
      createdAt: now,
      updatedAt: now,
    });

    for (const orgId of ["org_1", "org_2"]) {
      await db.upsertOrganization({
        id: orgId,
        name: orgId,
        slug: orgId,
        createdAt: now,
        updatedAt: now,
      });
      await db.upsertOrgMember({
        orgId,
        userId: "user_1",
        role: "member",
        createdAt: now,
      });
    }

    await db.setUserContext("org_1", "user_1", "# About Me\n\nAlice at Org 1", now);
    await db.setUserContext("org_2", "user_1", "# About Me\n\nAlice at Org 2", now);

    expect(await db.getUserContext("org_1", "user_1")).toBe("# About Me\n\nAlice at Org 1");
    expect(await db.getUserContext("org_2", "user_1")).toBe("# About Me\n\nAlice at Org 2");
  });
});
