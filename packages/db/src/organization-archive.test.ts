import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";

describe("organization archive persistence", () => {
  test("upsert and get round-trip archivedAt", async () => {
    const db = createInMemoryDatabaseAdapter();
    const archivedAt = "2026-08-21T00:00:00.000Z";

    await db.upsertOrganization({
      archivedAt,
      createdAt: archivedAt,
      id: "org_archived",
      name: "Archived",
      slug: "archived",
      updatedAt: archivedAt,
    });

    const loaded = await db.getOrganizationById("org_archived");
    expect(loaded?.archivedAt).toBe(archivedAt);

    const listed = await db.listOrganizations();
    expect(listed.some((org) => org.id === "org_archived")).toBe(true);
  });

  test("listUserOrganizations omits archived orgs and keeps active ones", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = "2026-08-21T00:00:00.000Z";

    await db.upsertOrganization({
      createdAt: now,
      id: "org_active",
      name: "Active",
      slug: "active",
      updatedAt: now,
    });
    await db.upsertOrganization({
      archivedAt: now,
      createdAt: now,
      id: "org_hidden",
      name: "Hidden",
      slug: "hidden",
      updatedAt: now,
    });
    await db.upsertOrgMember({
      createdAt: now,
      orgId: "org_active",
      role: "admin",
      userId: "user_1",
    });
    await db.upsertOrgMember({
      createdAt: now,
      orgId: "org_hidden",
      role: "admin",
      userId: "user_1",
    });

    const memberships = await db.listUserOrganizations("user_1");
    expect(memberships.map((membership) => membership.organization.id)).toEqual(
      ["org_active"]
    );
  });
});
