import { describe, expect, test } from "bun:test";
import { createSqliteDatabase } from "./adapters/sqlite";

const NOW = "2020-01-01T00:00:00.000Z";

function setupInput(email: string) {
  return {
    member: {
      createdAt: NOW,
      orgId: "org_boot",
      role: "admin" as const,
      userId: "user_admin",
    },
    organization: {
      createdAt: NOW,
      id: "org_boot",
      name: "Acme",
      slug: "acme",
      updatedAt: NOW,
    },
    user: {
      createdAt: NOW,
      email,
      id: "user_admin",
      isPlatformAdmin: true,
      name: "Admin",
      passwordHash: "hash",
      updatedAt: NOW,
    },
  };
}

describe("bootstrapInitialSetup", () => {
  test("rolls the organization back when the admin insert fails", async () => {
    const database = await createSqliteDatabase(":memory:");
    try {
      // The CLI bearer identity is not a human user, so the claim check passes
      // and the admin insert is what trips the unique email index.
      await database.adapter.createUser({
        createdAt: NOW,
        email: "taken@example.com",
        id: "user_local_client",
        passwordHash: "hash",
        updatedAt: NOW,
      });

      await expect(
        database.adapter.bootstrapInitialSetup(setupInput("taken@example.com"))
      ).rejects.toThrow();

      expect(await database.adapter.listOrganizations()).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  test("refuses to claim once a human user exists", async () => {
    const database = await createSqliteDatabase(":memory:");
    try {
      expect(
        await database.adapter.bootstrapInitialSetup(
          setupInput("first@example.com")
        )
      ).toBe(true);

      const second = setupInput("second@example.com");
      second.organization.id = "org_second";
      second.organization.slug = "second";
      second.member.orgId = "org_second";
      second.user.id = "user_second";

      expect(await database.adapter.bootstrapInitialSetup(second)).toBe(false);
      expect(await database.adapter.listOrganizations()).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});
