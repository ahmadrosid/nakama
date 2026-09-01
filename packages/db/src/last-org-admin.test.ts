import { describe, expect, test } from "bun:test";
import { createSqliteMemoryAdapter } from "./adapters/sqlite";
import type { DatabaseAdapter, OrgRole } from "./types";

const NOW = "2026-08-31T00:00:00.000Z";

async function seedOrgWithAdmins(
  db: DatabaseAdapter,
  roles: OrgRole[]
): Promise<string[]> {
  await db.upsertOrganization({
    createdAt: NOW,
    id: "org_a",
    name: "A",
    slug: "a",
    updatedAt: NOW,
  });

  const userIds: string[] = [];
  for (const [index, role] of roles.entries()) {
    const userId = `user_${index}`;
    await db.createUser({
      createdAt: NOW,
      email: `${userId}@example.com`,
      id: userId,
      passwordHash: "unused",
      updatedAt: NOW,
    });
    await db.upsertOrgMember({
      createdAt: NOW,
      orgId: "org_a",
      role,
      userId,
    });
    userIds.push(userId);
  }

  return userIds;
}

async function adminCount(db: DatabaseAdapter): Promise<number> {
  const members = await db.listOrgMembers("org_a");
  return members.filter((member) => member.role === "admin").length;
}

// The service checks the admin count before it writes, so two concurrent
// requests can both pass that check. These assert the guard that runs inside
// the statement instead.
describe("last org admin", () => {
  test("refuses to delete the only admin", async () => {
    const db = createSqliteMemoryAdapter();
    const [admin] = await seedOrgWithAdmins(db, ["admin", "viewer"]);

    expect(await db.deleteOrgMember("org_a", admin!)).toBe(false);
    expect(await adminCount(db)).toBe(1);
  });

  test("refuses to demote the only admin", async () => {
    const db = createSqliteMemoryAdapter();
    const [admin] = await seedOrgWithAdmins(db, ["admin", "viewer"]);

    expect(await db.updateOrgMemberRole("org_a", admin!, "viewer")).toBe(false);
    expect(await adminCount(db)).toBe(1);
  });

  test("allows the change while a second admin remains", async () => {
    const db = createSqliteMemoryAdapter();
    const [first] = await seedOrgWithAdmins(db, ["admin", "admin"]);

    expect(await db.updateOrgMemberRole("org_a", first!, "viewer")).toBe(true);
    expect(await adminCount(db)).toBe(1);
  });
});
