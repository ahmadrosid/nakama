import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "./index";
import { migrateDatabase } from "./migrate";
import type { StoredSkillRecord, StoredToolRecord } from "./types";

const now = "2026-09-07T00:00:00.000Z";

function createLegacyHostDatabase(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      model TEXT,
      is_super INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tools (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      handler_type TEXT NOT NULL,
      handler_config TEXT DEFAULT '{}' NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX tools_name_unique ON tools (name);
    CREATE TABLE profile_tools (
      profile_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      PRIMARY KEY (profile_id, tool_id)
    );
    CREATE TABLE skills (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      source_path TEXT NOT NULL,
      has_tool INTEGER DEFAULT 0 NOT NULL,
      disable_model_invocation INTEGER DEFAULT 0 NOT NULL,
      enabled INTEGER DEFAULT 1 NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'bundled',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX skills_source_path_unique ON skills (source_path);
    CREATE TABLE profile_skills (
      profile_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      PRIMARY KEY (profile_id, skill_id)
    );
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    INSERT INTO organizations (id, name, slug, created_at, updated_at)
    VALUES ('org_legacy', 'Legacy', 'legacy', '${now}', '${now}');
    INSERT INTO profiles (id, name, system_prompt, model, is_super, created_at, updated_at)
    VALUES ('default', 'Buddy', 'hello', NULL, 0, '${now}', '${now}');
    INSERT INTO tools (id, name, description, handler_type, handler_config, created_at, updated_at)
    VALUES ('tool_bash', 'bash', 'bash tool', 'bash', '{}', '${now}', '${now}');
    INSERT INTO skills (id, name, description, source_path, has_tool, disable_model_invocation, enabled, created_by, created_at, updated_at)
    VALUES ('skill_test', 'Test Skill', 'skill', '/tmp/test-skill', 0, 0, 1, 'human', '${now}', '${now}');
    INSERT INTO profile_tools (profile_id, tool_id) VALUES ('default', 'tool_bash');
    INSERT INTO profile_skills (profile_id, skill_id) VALUES ('default', 'skill_test');
  `);
  return db;
}

function notesManifest(version = "1.0.0") {
  return {
    actions: [
      {
        access: "member",
        description: "List notes",
        effect: "read",
        entry: "actions/list.js",
        exposeAsTool: true,
        inputSchema: { type: "object" },
        key: "list",
      },
    ],
    apiVersion: 1,
    author: "Nakama",
    description: "Notes",
    id: "notes",
    license: "MIT",
    minNakamaVersion: "0.1.0",
    name: "Notes",
    skills: [{ directory: "skills/notes", key: "notes" }],
    version,
  };
}

function skillContribution(
  orgId: string,
  overrides: Partial<StoredSkillRecord> = {}
): StoredSkillRecord {
  return {
    createdAt: now,
    createdBy: "human",
    description: "Notes skill",
    disableModelInvocation: false,
    enabled: true,
    hasTool: false,
    id: "skill_notes_new",
    name: "notes",
    orgId,
    pluginId: "notes",
    pluginKey: "notes",
    sourcePath: "plugins/notes/notes",
    updatedAt: now,
    ...overrides,
  };
}

function toolContribution(
  orgId: string,
  overrides: Partial<StoredToolRecord> = {}
): StoredToolRecord {
  return {
    createdAt: now,
    description: "List notes",
    handlerConfig: { actionKey: "list" },
    handlerType: "plugin",
    id: "tool_notes_new",
    name: "plugin_notes__list",
    orgId,
    pluginId: "notes",
    pluginKey: "list",
    updatedAt: now,
    ...overrides,
  };
}

describe("plugin metadata migration", () => {
  test("upgrades an existing database and preserves ordinary rows", () => {
    const db = createLegacyHostDatabase();

    try {
      migrateDatabase(db);
      migrateDatabase(db);

      const profile = db
        .prepare("SELECT id, name FROM profiles WHERE id = 'default'")
        .get() as { id: string; name: string };
      const skill = db
        .prepare(
          "SELECT id, name, plugin_id, plugin_key FROM skills WHERE id = 'skill_test'"
        )
        .get() as {
        id: string;
        name: string;
        plugin_id: string | null;
        plugin_key: string | null;
      };
      const tool = db
        .prepare(
          "SELECT id, name, plugin_id, plugin_key FROM tools WHERE id = 'tool_bash'"
        )
        .get() as {
        id: string;
        name: string;
        plugin_id: string | null;
        plugin_key: string | null;
      };
      const assignments = db
        .prepare(
          "SELECT profile_id, tool_id FROM profile_tools UNION ALL SELECT profile_id, skill_id FROM profile_skills"
        )
        .all() as Array<{ profile_id: string; tool_id: string }>;
      const pluginTables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('plugin_releases', 'org_plugins') ORDER BY name"
        )
        .all() as Array<{ name: string }>;

      expect(profile).toEqual({ id: "default", name: "Buddy" });
      expect(skill).toEqual({
        id: "skill_test",
        name: "Test Skill",
        plugin_id: null,
        plugin_key: null,
      });
      expect(tool).toEqual({
        id: "tool_bash",
        name: "bash",
        plugin_id: null,
        plugin_key: null,
      });
      expect(assignments).toHaveLength(2);
      expect(pluginTables.map((row) => row.name)).toEqual([
        "org_plugins",
        "plugin_releases",
      ]);
      const releaseColumns = db
        .prepare("PRAGMA table_info(plugin_releases)")
        .all() as Array<{ name: string }>;
      expect(releaseColumns.map((column) => column.name)).toContain("digest");
    } finally {
      db.close();
    }
  });
});

describe("plugin ownership adapter", () => {
  test("lets two organizations own the same contribution names separately", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertPluginRelease({
      createdAt: now,
      digest: "sha256:notes-1.0.0",
      manifest: notesManifest(),
      pluginId: "notes",
      version: "1.0.0",
    });

    const first = await db.publishOrgPluginRelease({
      contributions: {
        skills: [skillContribution("org_a", { id: "skill_a" })],
        tools: [toolContribution("org_a", { id: "tool_a" })],
      },
      databaseGeneration: "gen_1",
      expectedRevision: 0,
      lifecycleState: "disabled",
      now,
      orgId: "org_a",
      pluginId: "notes",
      selectedVersion: "1.0.0",
    });
    const second = await db.publishOrgPluginRelease({
      contributions: {
        skills: [skillContribution("org_b", { id: "skill_b" })],
        tools: [toolContribution("org_b", { id: "tool_b" })],
      },
      databaseGeneration: "gen_1",
      expectedRevision: 0,
      lifecycleState: "disabled",
      now,
      orgId: "org_b",
      pluginId: "notes",
      selectedVersion: "1.0.0",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const skills = (await db.listSkills()).filter(
      (skill) => skill.pluginId === "notes"
    );
    const tools = (await db.listTools()).filter(
      (tool) => tool.pluginId === "notes"
    );

    expect(skills.map((skill) => skill.id).sort()).toEqual([
      "skill_a",
      "skill_b",
    ]);
    expect(new Set(skills.map((skill) => skill.orgId))).toEqual(
      new Set(["org_a", "org_b"])
    );
    expect(tools.map((tool) => tool.name)).toEqual([
      "plugin_notes__list",
      "plugin_notes__list",
    ]);
    expect(new Set(tools.map((tool) => tool.id))).toEqual(
      new Set(["tool_a", "tool_b"])
    );
  });

  test("preserves contribution ids across a published release change", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertPluginRelease({
      createdAt: now,
      digest: "sha256:notes-1.0.0",
      manifest: notesManifest(),
      pluginId: "notes",
      version: "1.0.0",
    });
    await db.upsertPluginRelease({
      createdAt: now,
      digest: "sha256:notes-1.1.0",
      manifest: notesManifest("1.1.0"),
      pluginId: "notes",
      version: "1.1.0",
    });

    const created = await db.publishOrgPluginRelease({
      contributions: {
        skills: [skillContribution("org_a")],
        tools: [toolContribution("org_a")],
      },
      databaseGeneration: "gen_1",
      expectedRevision: 0,
      lifecycleState: "disabled",
      now,
      orgId: "org_a",
      pluginId: "notes",
      selectedVersion: "1.0.0",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const updated = await db.publishOrgPluginRelease({
      contributions: {
        skills: [
          skillContribution("org_a", {
            description: "Notes skill v2",
            id: "skill_should_be_ignored",
          }),
        ],
        tools: [
          toolContribution("org_a", {
            description: "List notes v2",
            id: "tool_should_be_ignored",
          }),
        ],
      },
      databaseGeneration: "gen_2",
      expectedRevision: created.revision,
      lifecycleState: "disabled",
      now,
      orgId: "org_a",
      pluginId: "notes",
      selectedVersion: "1.1.0",
    });

    expect(updated.ok).toBe(true);
    const skills = (await db.listSkills()).filter(
      (skill) => skill.orgId === "org_a" && skill.pluginId === "notes"
    );
    const tools = (await db.listTools()).filter(
      (tool) => tool.orgId === "org_a" && tool.pluginId === "notes"
    );
    const installation = await db.getOrgPlugin("org_a", "notes");

    expect(skills).toHaveLength(1);
    expect(skills[0]?.id).toBe("skill_notes_new");
    expect(skills[0]?.description).toBe("Notes skill v2");
    expect(tools[0]?.id).toBe("tool_notes_new");
    expect(tools[0]?.description).toBe("List notes v2");
    expect(installation?.selectedVersion).toBe("1.1.0");
    expect(installation?.databaseGeneration).toBe("gen_2");
    expect(installation?.revision).toBe(created.revision + 1);
  });

  test("compare-and-set publishes one write and rejects a stale revision", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertPluginRelease({
      createdAt: now,
      digest: "sha256:notes-1.0.0",
      manifest: notesManifest(),
      pluginId: "notes",
      version: "1.0.0",
    });
    await db.upsertPluginRelease({
      createdAt: now,
      digest: "sha256:notes-1.1.0",
      manifest: notesManifest("1.1.0"),
      pluginId: "notes",
      version: "1.1.0",
    });

    const first = await db.publishOrgPluginRelease({
      contributions: {
        skills: [skillContribution("org_a")],
        tools: [toolContribution("org_a")],
      },
      databaseGeneration: "gen_1",
      expectedRevision: 0,
      lifecycleState: "disabled",
      now,
      orgId: "org_a",
      pluginId: "notes",
      selectedVersion: "1.0.0",
    });
    const stale = await db.publishOrgPluginRelease({
      contributions: {
        skills: [skillContribution("org_a")],
        tools: [toolContribution("org_a")],
      },
      databaseGeneration: "gen_stale",
      expectedRevision: 0,
      lifecycleState: "disabled",
      now,
      orgId: "org_a",
      pluginId: "notes",
      selectedVersion: "1.1.0",
    });
    const next = first.ok
      ? await db.publishOrgPluginRelease({
          contributions: {
            skills: [skillContribution("org_a")],
            tools: [toolContribution("org_a")],
          },
          databaseGeneration: "gen_2",
          expectedRevision: first.revision,
          lifecycleState: "disabled",
          now,
          orgId: "org_a",
          pluginId: "notes",
          selectedVersion: "1.1.0",
        })
      : first;

    expect(first.ok).toBe(true);
    expect(stale).toEqual({ ok: false, reason: "stale_revision" });
    expect(next.ok).toBe(true);
    expect(await db.getOrgPlugin("org_a", "notes")).toMatchObject({
      databaseGeneration: "gen_2",
      selectedVersion: "1.1.0",
    });
  });

  test("rejects a colliding tool name in the same organization before publish", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertPluginRelease({
      createdAt: now,
      digest: "sha256:notes-1.0.0",
      manifest: notesManifest(),
      pluginId: "notes",
      version: "1.0.0",
    });
    await db.upsertTool({
      createdAt: now,
      description: "Existing",
      handlerConfig: {},
      handlerType: "javascript",
      id: "tool_existing",
      name: "plugin_notes__list",
      orgId: "org_a",
      updatedAt: now,
    });

    const result = await db.publishOrgPluginRelease({
      contributions: {
        skills: [skillContribution("org_a")],
        tools: [toolContribution("org_a")],
      },
      databaseGeneration: "gen_1",
      expectedRevision: 0,
      lifecycleState: "disabled",
      now,
      orgId: "org_a",
      pluginId: "notes",
      selectedVersion: "1.0.0",
    });

    expect(result).toEqual({ ok: false, reason: "tool_name_collision" });
    expect(await db.getOrgPlugin("org_a", "notes")).toBeNull();
    expect(
      (await db.listSkills()).filter((skill) => skill.pluginId === "notes")
    ).toHaveLength(0);
  });

  test("leaves ordinary unowned skills and tools unchanged", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertSkill({
      createdAt: now,
      createdBy: "human",
      description: "Custom",
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id: "skill_custom",
      name: "custom",
      orgId: "org_a",
      sourcePath: "/tmp/custom",
      updatedAt: now,
    });
    await db.upsertTool({
      createdAt: now,
      description: "Custom tool",
      handlerConfig: {},
      handlerType: "javascript",
      id: "tool_custom",
      name: "custom_tool",
      orgId: "org_a",
      updatedAt: now,
    });

    const skill = await db.getSkill("skill_custom");
    const tool = await db.getTool("tool_custom");

    expect(skill).toMatchObject({
      id: "skill_custom",
      pluginId: null,
      pluginKey: null,
    });
    expect(tool).toMatchObject({
      id: "tool_custom",
      name: "custom_tool",
      pluginId: null,
      pluginKey: null,
    });
  });

  test("reinstalling the same digest is idempotent and a different digest conflicts", async () => {
    const db = createInMemoryDatabaseAdapter();
    const first = await db.upsertPluginRelease({
      createdAt: now,
      digest: "sha256:same",
      manifest: notesManifest(),
      pluginId: "notes",
      version: "1.0.0",
    });
    const same = await db.upsertPluginRelease({
      createdAt: now,
      digest: "sha256:same",
      manifest: notesManifest(),
      pluginId: "notes",
      version: "1.0.0",
    });
    const conflict = await db.upsertPluginRelease({
      createdAt: now,
      digest: "sha256:other",
      manifest: notesManifest(),
      pluginId: "notes",
      version: "1.0.0",
    });

    expect(first).toEqual({ ok: true });
    expect(same).toEqual({ ok: true });
    expect(conflict).toEqual({ ok: false, reason: "digest_conflict" });
    expect(await db.getPluginRelease("notes", "1.0.0")).toMatchObject({
      digest: "sha256:same",
      version: "1.0.0",
    });
  });
});
