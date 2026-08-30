import { describe, expect, test } from "bun:test";
import {
  createSqliteDatabase,
  createSqliteMemoryAdapter,
} from "./adapters/sqlite";
import type { DatabaseAdapter } from "./types";

async function seedTwoActiveOrgs(db: DatabaseAdapter, createdAt: string) {
  await db.upsertOrganization({
    createdAt,
    id: "org_a",
    name: "A",
    slug: "a",
    updatedAt: createdAt,
  });
  await db.upsertOrganization({
    createdAt,
    id: "org_b",
    name: "B",
    slug: "b",
    updatedAt: createdAt,
  });
}

describe("organization archive persistence", () => {
  test("upsert and get round-trip archivedAt", async () => {
    const db = createSqliteMemoryAdapter();
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
    const db = createSqliteMemoryAdapter();
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

  test("tryMarkOrganizationArchived refuses the last active org", async () => {
    const db = createSqliteMemoryAdapter();
    const now = "2026-08-21T00:00:00.000Z";
    await db.upsertOrganization({
      createdAt: now,
      id: "org_only",
      name: "Only",
      slug: "only",
      updatedAt: now,
    });

    expect(await db.tryMarkOrganizationArchived("org_only", now)).toBe(false);
    expect((await db.getOrganizationById("org_only"))?.archivedAt).toBeFalsy();
  });

  test("tryMarkOrganizationArchived archives when another org remains", async () => {
    const db = createSqliteMemoryAdapter();
    const now = "2026-08-21T00:00:00.000Z";
    await seedTwoActiveOrgs(db, now);

    expect(await db.tryMarkOrganizationArchived("org_a", now)).toBe(true);
    expect((await db.getOrganizationById("org_a"))?.archivedAt).toBe(now);
  });

  test("tryMarkOrganizationArchived stamps updated_at separately from archived_at", async () => {
    const database = await createSqliteDatabase(":memory:");
    const db = database.adapter;
    const createdAt = "2026-01-01T00:00:00.000Z";
    const archivedAt = "2026-06-15T12:00:00.000Z";
    try {
      await seedTwoActiveOrgs(db, createdAt);

      const before = new Date().toISOString();
      expect(await db.tryMarkOrganizationArchived("org_a", archivedAt)).toBe(
        true
      );
      const after = new Date().toISOString();

      const org = await db.getOrganizationById("org_a");
      expect(org?.archivedAt).toBe(archivedAt);
      expect(org?.updatedAt).toBeDefined();
      expect(org?.updatedAt).not.toBe(archivedAt);
      expect(org!.updatedAt >= before).toBe(true);
      expect(org!.updatedAt <= after).toBe(true);
    } finally {
      database.close();
    }
  });
});
