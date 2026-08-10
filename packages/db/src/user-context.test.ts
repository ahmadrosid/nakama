import { describe, expect, test } from "bun:test";
import { USER_CONTEXT_TEMPLATE } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";

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
});
