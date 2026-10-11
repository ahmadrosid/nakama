import { describe, expect, test } from "bun:test";
import {
  createSqliteDatabase,
  createSqliteMemoryAdapter,
} from "./adapters/sqlite";
import type {
  DatabaseAdapter,
  StoredOrgSharedResourceRecord,
  StoredSkillRecord,
} from "./types";

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
  test("parent round-trips through lookups and survives ordinary updates", async () => {
    const db = createSqliteMemoryAdapter();
    const now = "2026-10-11T00:00:00.000Z";
    await seedTwoActiveOrgs(db, now);
    const team = {
      createdAt: now,
      id: "team",
      name: "Team",
      parentOrgId: "org_a",
      slug: "team",
      updatedAt: now,
    };
    await db.upsertOrganization(team);
    await db.upsertOrgMember({
      createdAt: now,
      orgId: "team",
      role: "admin",
      userId: "user_1",
    });
    expect((await db.getOrganizationById("team"))?.parentOrgId).toBe("org_a");
    expect((await db.getOrganizationBySlug("team"))?.parentOrgId).toBe("org_a");
    expect(
      (await db.listOrganizations()).find((org) => org.id === "team")
        ?.parentOrgId
    ).toBe("org_a");
    expect(
      (await db.listUserOrganizations("user_1"))[0]?.organization.parentOrgId
    ).toBe("org_a");
    await db.upsertOrganization({
      ...team,
      name: "Updated",
      parentOrgId: undefined,
    });
    expect((await db.getOrganizationById("team"))?.parentOrgId).toBe("org_a");
    await expect(
      db.upsertOrganization({ ...team, parentOrgId: "org_b" })
    ).rejects.toThrow();
    await expect(
      db.upsertOrganization({ ...team, parentOrgId: null })
    ).rejects.toThrow();
    for (const parentOrgId of ["missing", "team"]) {
      await expect(
        db.upsertOrganization({
          ...team,
          id: "child",
          parentOrgId,
          slug: "child",
        })
      ).rejects.toThrow();
    }
  });

  test("active teams prevent parent archive; all teams prevent parent deletion", async () => {
    const db = createSqliteMemoryAdapter();
    const now = "2026-10-11T00:00:00.000Z";
    await seedTwoActiveOrgs(db, now);
    const parent = await db.getOrganizationById("org_a");
    expect(parent).not.toBeNull();
    const team = {
      createdAt: now,
      id: "team",
      name: "Team",
      parentOrgId: "org_a",
      slug: "team",
      updatedAt: now,
    };
    await db.upsertOrganization(team);
    await db.upsertTool({
      createdAt: now,
      description: "",
      handlerConfig: {},
      handlerType: "javascript",
      id: "parent_tool",
      name: "parent_tool",
      orgId: "org_a",
      updatedAt: now,
    });
    expect(await db.tryMarkOrganizationArchived("org_a", now)).toBe(false);
    await expect(
      db.upsertOrganization({ ...parent!, archivedAt: now })
    ).rejects.toThrow();
    expect(await db.deleteOrganization("org_a")).toBe(false);
    expect(await db.getTool("parent_tool")).not.toBeNull();
    expect(await db.tryMarkOrganizationArchived("team", now)).toBe(true);
    expect(await db.tryMarkOrganizationArchived("org_a", now)).toBe(true);
    expect(await db.deleteOrganization("org_a")).toBe(false);
    await expect(db.upsertOrganization(team)).rejects.toThrow();
    await expect(
      db.upsertOrganization({ ...team, id: "new_team", slug: "new-team" })
    ).rejects.toThrow();
    expect(await db.deleteOrganization("team")).toBe(true);
    expect(await db.deleteOrganization("org_a")).toBe(true);
  });

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

  test("deleteOrganization removes dependent profiles and org-owned resources", async () => {
    const db = createSqliteMemoryAdapter();
    const now = "2026-08-21T00:00:00.000Z";
    await seedTwoActiveOrgs(db, now);
    await db.upsertProfile({
      createdAt: now,
      id: "profile_a",
      isDefault: true,
      isSuper: false,
      model: null,
      name: "A",
      orgId: "org_a",
      systemPrompt: "",
      updatedAt: now,
    });
    await db.upsertTool({
      createdAt: now,
      description: "Org tool",
      handlerConfig: {},
      handlerType: "javascript",
      id: "tool_a",
      name: "org_tool",
      orgId: "org_a",
      updatedAt: now,
    });
    await db.assignToolToProfile("profile_a", "tool_a");

    expect(await db.deleteOrganization("org_a")).toBe(true);

    expect(await db.getOrganizationById("org_a")).toBeNull();
    expect(await db.getProfile("profile_a")).toBeNull();
    expect(await db.getTool("tool_a")).toBeNull();
    expect(await db.getOrganizationById("org_b")).not.toBeNull();
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

describe("organization publications", () => {
  test("publication writes are idempotent and scoped to an active root", async () => {
    const db = createSqliteMemoryAdapter();
    const now = "2026-10-11T00:00:00.000Z";
    await seedTwoActiveOrgs(db, now);
    await db.upsertOrganization({
      createdAt: now,
      id: "team",
      name: "Team",
      parentOrgId: "org_a",
      slug: "team",
      updatedAt: now,
    });
    const source: StoredOrgSharedResourceRecord = {
      createdAt: now,
      id: "publication",
      orgId: "org_a",
      resourceId: "document",
      resourceKind: "knowledge",
      updatedAt: now,
    };
    expect(await db.publishOrgSharedResource(source)).toEqual(source);
    expect(
      await db.publishOrgSharedResource({
        ...source,
        id: "retry",
        updatedAt: "later",
      })
    ).toEqual(source);
    expect(await db.listOrgSharedResources("org_a")).toEqual([source]);
    expect(await db.listOrgSharedResources("team")).toEqual([]);
    expect(await db.getOrgSharedResource("org_b", source.id)).toBeNull();
    expect(await db.deleteOrgSharedResource("org_b", source.id)).toBe(false);
    expect(await db.getOrgSharedResource("org_a", source.id)).toEqual(source);
    for (const orgId of ["missing", "team"]) {
      await expect(
        db.publishOrgSharedResource({ ...source, id: "invalid", orgId })
      ).rejects.toThrow();
    }
    expect(await db.tryMarkOrganizationArchived("org_b", now)).toBe(true);
    await expect(
      db.publishOrgSharedResource({ ...source, id: "archived", orgId: "org_b" })
    ).rejects.toThrow();
    expect(await db.deleteOrgSharedResource("org_a", source.id)).toBe(true);
    expect(await db.getOrgSharedResource("org_a", source.id)).toBeNull();
    expect(
      await db.publishOrgSharedResource({ ...source, id: "republished" })
    ).toEqual({ ...source, id: "republished" });
  });

  test("SQL sources require valid ownership and their deletion removes publications", async () => {
    const db = createSqliteMemoryAdapter();
    const now = "2026-10-11T00:00:00.000Z";
    await seedTwoActiveOrgs(db, now);
    const profile = {
      createdAt: now,
      id: "agent",
      isDefault: false,
      isSuper: false,
      model: null,
      name: "Agent",
      orgId: "org_a",
      systemPrompt: "",
      updatedAt: now,
    };
    await db.upsertProfile(profile);
    await db.upsertProfile({ ...profile, id: "default", isDefault: true });
    await db.upsertProfile({ ...profile, id: "super", isSuper: true });
    await db.upsertProfile({ ...profile, id: "foreign", orgId: "org_b" });
    const skill: StoredSkillRecord = {
      createdAt: now,
      createdBy: "human",
      description: "",
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id: "skill",
      name: "Skill",
      orgId: "org_a",
      sourcePath: "/source",
      updatedAt: now,
    };
    await db.upsertSkill(skill);
    await db.upsertSkill({
      ...skill,
      id: "foreign-skill",
      name: "Foreign",
      orgId: "org_b",
      sourcePath: "/foreign",
    });
    await db.upsertSkill({
      ...skill,
      enabled: false,
      id: "disabled",
      name: "Disabled",
      sourcePath: "/disabled",
    });
    const tool = {
      createdAt: now,
      description: "",
      handlerConfig: {},
      handlerType: "javascript",
      id: "tool",
      name: "tool",
      orgId: "org_a",
      updatedAt: now,
    };
    await db.upsertTool(tool);
    await db.upsertTool({
      ...tool,
      id: "foreign-tool",
      name: "foreign_tool",
      orgId: "org_b",
    });
    await db.upsertTool({
      ...tool,
      id: "global-tool",
      name: "global_tool",
      orgId: null,
    });
    const source: StoredOrgSharedResourceRecord = {
      createdAt: now,
      id: "publication",
      orgId: "org_a",
      resourceId: "agent",
      resourceKind: "agent",
      updatedAt: now,
    };
    for (const resourceId of ["missing", "foreign", "default", "super"]) {
      await expect(
        db.publishOrgSharedResource({ ...source, resourceId })
      ).rejects.toThrow();
    }
    for (const resourceId of ["missing", "foreign-skill", "disabled"]) {
      await expect(
        db.publishOrgSharedResource({
          ...source,
          resourceId,
          resourceKind: "skill",
        })
      ).rejects.toThrow();
    }
    for (const resourceId of ["missing", "foreign-tool"]) {
      await expect(
        db.publishOrgSharedResource({
          ...source,
          resourceId,
          resourceKind: "tool",
        })
      ).rejects.toThrow();
    }
    for (const resourceKind of ["agent", "skill", "tool"] as const) {
      await db.publishOrgSharedResource({
        ...source,
        id: resourceKind,
        resourceId: resourceKind,
        resourceKind,
      });
    }
    await db.publishOrgSharedResource({
      ...source,
      id: "global",
      resourceId: "global-tool",
      resourceKind: "tool",
    });
    await db.deleteProfile("agent");
    await db.deleteSkill("skill");
    await db.deleteTool("tool");
    expect(
      (await db.listOrgSharedResources("org_a")).map((row) => row.id)
    ).toEqual(["global"]);
    expect((await db.getTool("global-tool"))?.orgId).toBeNull();
    await db.deleteTool("global-tool");
    expect(await db.listOrgSharedResources("org_a")).toEqual([]);
  });
});
