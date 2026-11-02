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
    const [admin] = await seedOrgWithAdmins(db, ["admin"]);

    expect(await db.deleteOrgMember("org_a", admin!)).toBe(false);
    expect(await adminCount(db)).toBe(1);
  });

  test("refuses to demote the only admin", async () => {
    const db = createSqliteMemoryAdapter();
    const [admin] = await seedOrgWithAdmins(db, ["admin"]);

    expect(await db.updateOrgMemberRole("org_a", admin!, "member")).toBe(false);
    expect(await adminCount(db)).toBe(1);
  });

  test("allows the change while a second admin remains", async () => {
    const db = createSqliteMemoryAdapter();
    const [first] = await seedOrgWithAdmins(db, ["admin", "admin"]);

    expect(await db.updateOrgMemberRole("org_a", first!, "member")).toBe(true);
    expect(await adminCount(db)).toBe(1);
  });

  // disabled_at lives on users and never touches org_members, so a disabled
  // admin row must not count as usable coverage inside the statement.
  test("refuses to delete the last usable admin while a disabled admin row remains", async () => {
    const db = createSqliteMemoryAdapter();

    const [first, second, disabled] = await seedOrgWithAdmins(db, [
      "admin",
      "admin",
      "admin",
    ]);

    await db.disableUser(disabled!, NOW);

    // Two usable admins: the first removal is allowed.
    expect(await db.deleteOrgMember("org_a", first!)).toBe(true);

    // Only one usable admin is left; deleting it while a disabled admin row
    // remains would leave the org with no admin who can sign in.
    expect(await db.deleteOrgMember("org_a", second!)).toBe(false);
    expect(await adminCount(db)).toBe(2);
  });

  test("refuses to demote the last usable admin while a disabled admin row remains", async () => {
    const db = createSqliteMemoryAdapter();

    const [first, second, disabled] = await seedOrgWithAdmins(db, [
      "admin",
      "admin",
      "admin",
    ]);

    await db.disableUser(disabled!, NOW);

    expect(await db.updateOrgMemberRole("org_a", first!, "member")).toBe(true);

    expect(await db.updateOrgMemberRole("org_a", second!, "member")).toBe(
      false
    );
    expect(await adminCount(db)).toBe(2);
  });
});

async function usableAdminCount(db: DatabaseAdapter): Promise<number> {
  const members = await db.listOrgMembers("org_a");

  const admins = await Promise.all(
    members
      .filter((member) => member.role === "admin")
      .map((member) => db.getUserById(member.userId))
  );

  return admins.filter((user) => user && !user.disabledAt).length;
}

// disabled_at is install-wide, so the disable statement has to re-check every
// org the user administers. Each pair below is a race the service check alone
// lets through; whichever write lands second must be refused.
describe("disable last usable admin", () => {
  const cases: {
    name: string;
    first: (db: DatabaseAdapter, a: string, b: string) => Promise<boolean>;
    second: (db: DatabaseAdapter, a: string, b: string) => Promise<boolean>;
  }[] = [
    {
      first: (db, a) => db.disableUserUnlessLastAdmin(a, NOW),
      name: "disable A then remove B",
      second: (db, _a, b) => db.deleteOrgMember("org_a", b),
    },
    {
      first: (db, _a, b) => db.deleteOrgMember("org_a", b),
      name: "remove B then disable A",
      second: (db, a) => db.disableUserUnlessLastAdmin(a, NOW),
    },
    {
      first: (db, _a, b) => db.updateOrgMemberRole("org_a", b, "member"),
      name: "demote B then disable A",
      second: (db, a) => db.disableUserUnlessLastAdmin(a, NOW),
    },
    {
      first: (db, a) => db.disableUserUnlessLastAdmin(a, NOW),
      name: "disable A then disable B",
      second: (db, _a, b) => db.disableUserUnlessLastAdmin(b, NOW),
    },
  ];

  for (const { first, name, second } of cases) {
    test(`${name}: the second write is refused`, async () => {
      const db = createSqliteMemoryAdapter();

      const [a, b, disabled] = await seedOrgWithAdmins(db, [
        "admin",
        "admin",
        "admin",
      ]);

      await db.disableUser(disabled!, NOW);

      expect(await first(db, a!, b!)).toBe(true);
      expect(await second(db, a!, b!)).toBe(false);
      expect(await usableAdminCount(db)).toBe(1);
    });
  }

  test("disables a plain member", async () => {
    const db = createSqliteMemoryAdapter();
    const [, member] = await seedOrgWithAdmins(db, ["admin", "member"]);

    expect(await db.disableUserUnlessLastAdmin(member!, NOW)).toBe(true);
    expect((await db.getUserById(member!))?.disabledAt).toBe(NOW);
  });

  test("an archived org does not block the disable", async () => {
    const db = createSqliteMemoryAdapter();
    const [admin] = await seedOrgWithAdmins(db, ["admin"]);

    // The install refuses to archive its only live org.
    await db.upsertOrganization({
      createdAt: NOW,
      id: "org_b",
      name: "B",
      slug: "b",
      updatedAt: NOW,
    });

    expect(await db.tryMarkOrganizationArchived("org_a", NOW)).toBe(true);
    expect(await db.disableUserUnlessLastAdmin(admin!, NOW)).toBe(true);
  });

  test("refuses to disable the last usable platform admin", async () => {
    const db = createSqliteMemoryAdapter();

    for (const id of ["platform_a", "platform_b"]) {
      await db.createUser({
        createdAt: NOW,
        email: `${id}@example.com`,
        id,
        isPlatformAdmin: true,
        passwordHash: "unused",
        updatedAt: NOW,
      });
    }

    expect(await db.disableUserUnlessLastAdmin("platform_a", NOW)).toBe(true);
    expect(await db.disableUserUnlessLastAdmin("platform_b", NOW)).toBe(false);
    expect((await db.getUserById("platform_b"))?.disabledAt).toBeFalsy();
  });
});
