import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSqliteDatabase,
  createSqliteMemoryAdapter,
} from "./adapters/sqlite";
import type {
  BeginOrgTeamCreationInput,
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

async function seedSharedAgent(db: DatabaseAdapter) {
  const now = "2026-10-11T00:00:00.000Z";
  await seedTwoActiveOrgs(db, now);

  for (const id of ["team_a", "team_b"]) {
    await db.upsertOrganization({
      createdAt: now,
      id,
      name: id,
      parentOrgId: "org_a",
      slug: id,
      updatedAt: now,
    });
  }

  const source = {
    createdAt: now,
    id: "source",
    isDefault: false,
    isSuper: false,
    model: "provider::model",
    name: "Source",
    orgId: "org_a",
    systemPrompt: "Source instructions",
    updatedAt: now,
  };

  await db.upsertProfile(source);

  const publication = await db.publishOrgSharedResource({
    createdAt: now,
    id: "agent-publication",
    orgId: "org_a",
    resourceId: "source",
    resourceKind: "agent",
    updatedAt: now,
  });

  return { now, publication, source };
}

describe("shared agent instance persistence", () => {
  test("unsupported ACP configuration cannot enter a team through selection or retry", async () => {
    const db = createSqliteMemoryAdapter();
    const { now, publication, source } = await seedSharedAgent(db);

    const instance = await db.createSharedAgentInstance(
      "team_a",
      publication.id,
      "instance",
      now
    );

    const link = await db.getSharedAgentInstance("team_a", instance.id);

    for (const changes of [
      { acpAgent: { args: ["--token", "parent-secret"], command: "agent" } },
      { acpSettings: { token: "parent-secret" } },
    ]) {
      await db.upsertProfile({ ...source, ...changes });

      for (const teamOrgId of ["team_a", "team_b"]) {
        await expect(
          db.createSharedAgentInstance(
            teamOrgId,
            publication.id,
            "new-instance",
            now
          )
        ).rejects.toThrow();
      }

      expect(await db.getProfile("new-instance")).toBeNull();
      expect(await db.getProfile(instance.id)).toEqual(instance);
      expect(await db.getSharedAgentInstance("team_a", instance.id)).toEqual(
        link
      );
    }
  });

  test("concurrent selections create one team profile without source history or assignments", async () => {
    const db = createSqliteMemoryAdapter();
    const { now, publication, source } = await seedSharedAgent(db);
    await db.upsertSession({
      agentQuestionnaire: null,
      agentTodos: [],
      channel: "web",
      createdAt: now,
      id: "source-session",
      model: null,
      profileId: source.id,
      title: null,
      userId: null,
    });
    await db.upsertTool({
      createdAt: now,
      description: "",
      handlerConfig: {},
      handlerType: "javascript",
      id: "private-tool",
      name: "private_tool",
      orgId: "org_a",
      updatedAt: now,
    });
    await db.assignToolToProfile(source.id, "private-tool");
    await db.upsertProfile({
      ...source,
      automationsEnabled: false,
      skillsCuratorConsolidateEnabled: true,
      skillsPostTurnReview: false,
      skillsWriteApproval: false,
    });

    const [first, second] = await Promise.all([
      db.createSharedAgentInstance("team_a", publication.id, "instance_a", now),
      db.createSharedAgentInstance("team_a", publication.id, "retry_a", now),
    ]);

    expect(first).toEqual({
      ...source,
      acpAgent: null,
      acpSettings: null,
      automationsEnabled: true,
      groupsEnabled: true,
      id: "instance_a",
      orgId: "team_a",
      ownerUserId: null,
      sharedWithTeam: true,
      skillsCuratorConsolidateEnabled: null,
      skillsPostTurnReview: null,
      skillsWriteApproval: null,
      thinkingEffort: null,
      thinkingEnabled: null,
    });
    expect(second).toEqual(first);
    expect(await db.getProfile("retry_a")).toBeNull();
    expect(
      (await db.listSessions()).filter((row) => row.profileId === first.id)
    ).toEqual([]);
    expect(await db.listToolsForProfile(first.id)).toEqual([]);
    expect(await db.getSharedAgentInstance("team_a", first.id)).toEqual({
      createdAt: now,
      profileId: first.id,
      publicationId: publication.id,
      sourceOrgId: "org_a",
      sourceProfileId: source.id,
      teamOrgId: "team_a",
    });
    expect(await db.getSharedAgentInstance("team_b", first.id)).toBeNull();

    const sibling = await db.createSharedAgentInstance(
      "team_b",
      publication.id,
      "instance_b",
      now
    );

    expect(sibling.orgId).toBe("team_b");
    expect(sibling.id).not.toBe(first.id);

    for (const teamOrgId of ["org_a", "org_b", "missing"]) {
      await expect(
        db.createSharedAgentInstance(teamOrgId, publication.id, "invalid", now)
      ).rejects.toThrow();
    }

    await expect(
      db.createSharedAgentInstance("team_a", "missing", "invalid", now)
    ).rejects.toThrow();
    expect(await db.getProfile(source.id)).toEqual(
      expect.objectContaining(source)
    );
  });

  test("revocation keeps source links and sessions; explicit selection can reconnect the same instance", async () => {
    const db = createSqliteMemoryAdapter();
    const { now, publication, source } = await seedSharedAgent(db);

    const instance = await db.createSharedAgentInstance(
      "team_a",
      publication.id,
      "instance",
      now
    );

    await db.upsertSession({
      agentQuestionnaire: null,
      agentTodos: [],
      channel: "web",
      createdAt: now,
      id: "team-session",
      model: null,
      profileId: instance.id,
      title: null,
      userId: null,
    });
    await db.deleteOrgSharedResource("org_a", publication.id);
    await expect(
      db.createSharedAgentInstance("team_a", publication.id, "retry", now)
    ).rejects.toThrow();
    expect(
      (await db.getSharedAgentInstance("team_a", instance.id))?.publicationId
    ).toBe(publication.id);

    const republished = await db.publishOrgSharedResource({
      ...publication,
      id: "republished",
    });

    expect(
      (
        await db.createSharedAgentInstance(
          "team_a",
          republished.id,
          "retry",
          now
        )
      ).id
    ).toBe(instance.id);
    expect(
      (await db.getSharedAgentInstance("team_a", instance.id))?.publicationId
    ).toBe(republished.id);
    expect((await db.getSession("team-session"))?.profileId).toBe(instance.id);
    expect(await db.tryMarkOrganizationArchived("team_a", now)).toBe(true);
    await expect(
      db.createSharedAgentInstance("team_a", republished.id, "retry", now)
    ).rejects.toThrow();
    await db.deleteProfile(source.id);
    await expect(
      db.createSharedAgentInstance("team_b", republished.id, "retry", now)
    ).rejects.toThrow();
    expect(await db.getProfile(instance.id)).not.toBeNull();
    expect(
      await db.getSharedAgentInstance("team_a", instance.id)
    ).not.toBeNull();
    await db.deleteProfile(instance.id);
    expect(await db.getSharedAgentInstance("team_a", instance.id)).toBeNull();
  });

  test("failed source-link insertion rolls back the new profile", async () => {
    const directory = mkdtempSync(join(tmpdir(), "nakama-shared-agent-"));
    const path = join(directory, "test.sqlite");
    const database = await createSqliteDatabase(`file:${path}`);
    const raw = new Database(path);

    try {
      const { now, publication } = await seedSharedAgent(database.adapter);
      raw.exec(
        `CREATE TRIGGER reject_shared_instance BEFORE INSERT ON shared_agent_instances BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`
      );
      await expect(
        database.adapter.createSharedAgentInstance(
          "team_a",
          publication.id,
          "instance",
          now
        )
      ).rejects.toThrow();
      expect(await database.adapter.getProfile("instance")).toBeNull();
      expect(
        await database.adapter.getSharedAgentInstance("team_a", "instance")
      ).toBeNull();
      raw.exec("DROP TRIGGER reject_shared_instance;");
      expect(
        (
          await database.adapter.createSharedAgentInstance(
            "team_a",
            publication.id,
            "instance",
            now
          )
        ).id
      ).toBe("instance");
      expect(raw.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      raw.close();
      database.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});

async function seedTeamCreation(
  db: DatabaseAdapter
): Promise<BeginOrgTeamCreationInput> {
  const now = "2026-10-11T00:00:00.000Z";
  await seedTwoActiveOrgs(db, now);

  for (const id of ["creator", "admin", "member"]) {
    await db.createUser({
      createdAt: now,
      email: `${id}@example.com`,
      id,
      passwordHash: "test",
      updatedAt: now,
    });
  }

  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_a",
    role: "admin",
    userId: "creator",
  });
  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_a",
    role: "member",
    userId: "member",
  });

  return {
    adminUserId: "admin",
    creatorUserId: "creator",
    organization: {
      createdAt: now,
      id: "team",
      name: "Team",
      parentOrgId: "org_a",
      slug: "team",
      updatedAt: now,
    },
    requestHash: "hash",
    requestId: "request",
  };
}

describe("atomic team creation records", () => {
  test("retries retain one team and keep incomplete setup outside memberships", async () => {
    const db = createSqliteMemoryAdapter();
    const input = await seedTeamCreation(db);

    const [first, retry] = await Promise.all([
      db.beginOrgTeamCreation(input),
      db.beginOrgTeamCreation({
        ...input,
        organization: { ...input.organization, id: "retry", slug: "retry" },
      }),
    ]);

    expect(first).toEqual(retry);
    expect(first.completedAt).toBeNull();
    expect(first.teamOrgId).toBe("team");
    expect(await db.getOrganizationById("retry")).toBeNull();
    expect((await db.getOrganizationById("team"))?.setupPending).toBe(true);
    expect(await db.listUserOrganizations("admin")).toEqual([]);
    expect(await db.getOrgMember("team", "admin")).toEqual(
      expect.objectContaining({ role: "admin" })
    );
    expect(await db.getOrgMember("team", "creator")).toBeNull();
    await expect(
      db.beginOrgTeamCreation({ ...input, requestHash: "other" })
    ).rejects.toThrow();
    expect(
      await db.completeOrgTeamCreation("org_a", "request", "team", "done")
    ).toBe(false);

    for (const [id, isDefault, isSuper] of [
      ["default", true, false],
      ["super", false, true],
    ] as const) {
      await db.upsertProfile({
        createdAt: "now",
        id,
        isDefault,
        isSuper,
        model: null,
        name: id,
        orgId: "team",
        systemPrompt: "",
        updatedAt: "now",
      });
    }

    expect(
      await db.completeOrgTeamCreation("org_a", "request", "wrong-team", "done")
    ).toBe(false);
    expect(
      await db.completeOrgTeamCreation("org_a", "request", "team", "done")
    ).toBe(true);
    expect(
      await db.completeOrgTeamCreation("org_a", "request", "team", "later")
    ).toBe(true);
    expect((await db.getOrganizationById("team"))?.setupPending).toBe(false);
    expect(
      (await db.listUserOrganizations("admin")).map(
        (row) => row.organization.id
      )
    ).toEqual(["team"]);
    expect((await db.beginOrgTeamCreation(input)).completedAt).toBe("done");
    expect(await db.abortOrgTeamCreation("org_a", "request", "team")).toBe(
      false
    );
    expect(await db.deleteOrganization("team")).toBe(true);
    expect((await db.beginOrgTeamCreation(input)).teamOrgId).toBe("team");
    expect(await db.getOrganizationById("team")).toBeNull();
  });

  test("failed setup cleanup preserves the parent and user accounts; archive serializes with creation", async () => {
    const db = createSqliteMemoryAdapter();
    const input = await seedTeamCreation(db);
    await expect(
      db.beginOrgTeamCreation({ ...input, creatorUserId: "member" })
    ).rejects.toThrow();
    await expect(
      db.beginOrgTeamCreation({ ...input, adminUserId: "missing" })
    ).rejects.toThrow();
    await db.disableUser("admin", "now");
    await expect(db.beginOrgTeamCreation(input)).rejects.toThrow();
    await db.enableUser("admin");

    const [request, archived] = await Promise.all([
      db.beginOrgTeamCreation(input),
      db.tryMarkOrganizationArchived("org_a", "now"),
    ]);

    expect(request.teamOrgId).toBe("team");
    expect(archived).toBe(false);
    await db.upsertProfile({
      createdAt: "now",
      id: "partial-profile",
      isDefault: true,
      isSuper: false,
      model: null,
      name: "Partial",
      orgId: "team",
      systemPrompt: "",
      updatedAt: "now",
    });
    expect(await db.abortOrgTeamCreation("org_b", "request", "team")).toBe(
      false
    );
    expect(
      await db.abortOrgTeamCreation("org_a", "request", "wrong-team")
    ).toBe(false);
    expect(await db.abortOrgTeamCreation("org_a", "request", "team")).toBe(
      true
    );
    expect(await db.getOrganizationById("team")).toBeNull();
    expect(await db.getProfile("partial-profile")).toBeNull();
    expect(await db.getOrgMember("team", "admin")).toBeNull();
    expect(await db.getUserById("admin")).not.toBeNull();
    expect(await db.getOrgMember("org_a", "creator")).not.toBeNull();
    expect((await db.beginOrgTeamCreation(input)).teamOrgId).toBe("team");
    expect(await db.abortOrgTeamCreation("org_a", "request", "team")).toBe(
      true
    );
    expect(await db.tryMarkOrganizationArchived("org_a", "now")).toBe(true);
    await expect(db.beginOrgTeamCreation(input)).rejects.toThrow();
    expect(await db.getOrganizationById("team")).toBeNull();
  });

  test.each(["org_members", "org_team_creation_requests"])(
    "failure writing %s rolls back the child and admin",
    async (table) => {
      const directory = mkdtempSync(join(tmpdir(), "nakama-team-creation-"));
      const path = join(directory, "test.sqlite");
      const database = await createSqliteDatabase(`file:${path}`);
      const raw = new Database(path);

      try {
        const input = await seedTeamCreation(database.adapter);
        raw.exec(
          `CREATE TRIGGER reject_team_creation BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`
        );
        await expect(
          database.adapter.beginOrgTeamCreation(input)
        ).rejects.toThrow();
        expect(await database.adapter.getOrganizationById("team")).toBeNull();
        expect(await database.adapter.getOrgMember("team", "admin")).toBeNull();
        expect(
          raw.query("SELECT * FROM org_team_creation_requests").all()
        ).toEqual([]);
        expect(await database.adapter.getUserById("admin")).not.toBeNull();
        raw.exec("DROP TRIGGER reject_team_creation;");
        expect(
          (await database.adapter.beginOrgTeamCreation(input)).teamOrgId
        ).toBe("team");
        expect(raw.query("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        raw.close();
        database.close();
        rmSync(directory, { force: true, recursive: true });
      }
    }
  );
});
