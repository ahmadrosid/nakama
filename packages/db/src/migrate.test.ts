import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateDatabase, resolveSchemaPath } from "./migrate";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("legacy profile id migration", () => {
  test("renames legacy default and super bot profiles and preserves references", () => {
    const db = new Database(":memory:");

    try {
      migrateDatabase(db);

      db.exec(`
        INSERT INTO profiles (
          id,
          name,
          system_prompt,
          model,
          thinking_enabled,
          thinking_effort,
          is_super,
          created_at,
          updated_at
        ) VALUES
          ('profile_default', 'Buddy', 'default prompt', NULL, NULL, NULL, 0, '2026-06-19T00:00:00.000Z', '2026-06-19T00:00:00.000Z'),
          ('profile_super_bot', 'Super Bot', 'super prompt', NULL, NULL, NULL, 1, '2026-06-19T00:00:00.000Z', '2026-06-19T00:00:00.000Z');

        INSERT INTO tools (
          id,
          name,
          description,
          handler_type,
          handler_config,
          created_at,
          updated_at
        ) VALUES (
          'tool_bash',
          'bash',
          'bash tool',
          'bash',
          '{}',
          '2026-06-19T00:00:00.000Z',
          '2026-06-19T00:00:00.000Z'
        );

        INSERT INTO mcp_servers (
          id,
          name,
          transport,
          config,
          enabled,
          status,
          last_error,
          cached_tools,
          created_at,
          updated_at
        ) VALUES (
          'mcp_test',
          'Test MCP',
          'stdio',
          '{}',
          1,
          'disconnected',
          NULL,
          '[]',
          '2026-06-19T00:00:00.000Z',
          '2026-06-19T00:00:00.000Z'
        );

        INSERT INTO skills (
          id,
          name,
          description,
          source_path,
          has_tool,
          disable_model_invocation,
          enabled,
          created_at,
          updated_at
        ) VALUES (
          'skill_test',
          'Test Skill',
          'skill',
          '/tmp/test-skill',
          0,
          0,
          1,
          '2026-06-19T00:00:00.000Z',
          '2026-06-19T00:00:00.000Z'
        );

        INSERT INTO profile_tools (profile_id, tool_id) VALUES
          ('profile_default', 'tool_bash'),
          ('profile_super_bot', 'tool_bash');

        INSERT INTO profile_mcp_servers (profile_id, server_id) VALUES
          ('profile_default', 'mcp_test'),
          ('profile_super_bot', 'mcp_test');

        INSERT INTO profile_skills (profile_id, skill_id) VALUES
          ('profile_default', 'skill_test'),
          ('profile_super_bot', 'skill_test');

        INSERT INTO sessions (id, profile_id, channel, created_at, title, agent_todos) VALUES
          ('session_default', 'profile_default', 'cli', '2026-06-19T00:00:00.000Z', NULL, '[]'),
          ('session_super', 'profile_super_bot', 'cli', '2026-06-19T00:00:00.000Z', NULL, '[]');

        INSERT INTO tasks (
          id,
          title,
          description,
          prompt,
          profile_id,
          status,
          position,
          session_id,
          created_at,
          updated_at
        ) VALUES
          ('task_default', 'Task', '', 'prompt', 'profile_default', 'backlog', 0, 'session_default', '2026-06-19T00:00:00.000Z', '2026-06-19T00:00:00.000Z'),
          ('task_super', 'Task', '', 'prompt', 'profile_super_bot', 'backlog', 0, 'session_super', '2026-06-19T00:00:00.000Z', '2026-06-19T00:00:00.000Z');

        INSERT INTO automations (
          id,
          name,
          version,
          definition,
          profile_id,
          enabled,
          created_at,
          updated_at
        ) VALUES
          ('automation_default', 'Automation', 1, '{}', 'profile_default', 1, '2026-06-19T00:00:00.000Z', '2026-06-19T00:00:00.000Z'),
          ('automation_super', 'Automation', 1, '{}', 'profile_super_bot', 1, '2026-06-19T00:00:00.000Z', '2026-06-19T00:00:00.000Z');
      `);

      migrateDatabase(db);

      const profiles = db.prepare("SELECT id FROM profiles ORDER BY id").all() as Array<{
        id: string;
      }>;
      const profileTools = db
        .prepare("SELECT profile_id FROM profile_tools ORDER BY profile_id")
        .all() as Array<{ profile_id: string }>;
      const profileMcpServers = db
        .prepare("SELECT profile_id FROM profile_mcp_servers ORDER BY profile_id")
        .all() as Array<{ profile_id: string }>;
      const profileSkills = db
        .prepare("SELECT profile_id FROM profile_skills ORDER BY profile_id")
        .all() as Array<{ profile_id: string }>;
      const sessions = db
        .prepare("SELECT profile_id FROM sessions ORDER BY id")
        .all() as Array<{ profile_id: string }>;
      const tasks = db
        .prepare("SELECT profile_id FROM tasks ORDER BY id")
        .all() as Array<{ profile_id: string }>;
      const automations = db
        .prepare("SELECT profile_id FROM automations ORDER BY id")
        .all() as Array<{ profile_id: string }>;
      const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all();

      expect(profiles.map((row) => row.id)).toEqual(["default", "super_bot"]);
      expect(profileTools.map((row) => row.profile_id)).toEqual(["default", "super_bot"]);
      expect(profileMcpServers.map((row) => row.profile_id)).toEqual([
        "default",
        "super_bot",
      ]);
      expect(profileSkills.map((row) => row.profile_id)).toEqual(["default", "super_bot"]);
      expect(sessions.map((row) => row.profile_id)).toEqual(["default", "super_bot"]);
      expect(tasks.map((row) => row.profile_id)).toEqual(["default", "super_bot"]);
      expect(automations.map((row) => row.profile_id)).toEqual(["default", "super_bot"]);
      expect(foreignKeyViolations).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

describe("schema path resolution", () => {
  test("resolves schema.sql from the db package during source execution", () => {
    const schemaPath = resolveSchemaPath();

    expect(schemaPath).toBe(resolve(repoRoot, "packages/db/sql/schema.sql"));
  });

  test("falls back to the workspace schema when running from the bundled server output", () => {
    const schemaPath = resolveSchemaPath({
      moduleDir: resolve(repoRoot, "apps/server/dist"),
      cwd: repoRoot,
    });

    expect(schemaPath).toBe(resolve(repoRoot, "packages/db/sql/schema.sql"));
  });
});

describe("browser session schema", () => {
  test("creates browser session storage with the expected columns", () => {
    const db = new Database(":memory:");

    try {
      migrateDatabase(db);

      const columns = db.prepare("PRAGMA table_info(browser_sessions)").all() as Array<{
        name: string;
      }>;
      const indexes = db.prepare("PRAGMA index_list(browser_sessions)").all() as Array<{
        name: string;
      }>;

      expect(columns.map((column) => column.name)).toEqual([
        "id",
        "user_id",
        "session_token_hash",
        "csrf_token_hash",
        "created_at",
        "expires_at",
        "revoked_at",
        "last_used_at",
        "active_org_id",
      ]);
      expect(indexes.some((index) => index.name === "browser_sessions_token_hash_unique")).toBe(
        true,
      );
    } finally {
      db.close();
    }
  });
});

describe("organization schema migration", () => {
  test("creates org tables and allows org with admin member", () => {
    const db = new Database(":memory:");

    try {
      migrateDatabase(db);

      db.exec(`
        INSERT INTO users (
          id, email, password_hash, is_platform_admin, created_at, updated_at
        ) VALUES (
          'user_admin', 'admin@example.com', 'hash', 1,
          '2026-06-21T00:00:00.000Z', '2026-06-21T00:00:00.000Z'
        );

        INSERT INTO organizations (
          id, name, slug, created_at, updated_at
        ) VALUES (
          'org_acme', 'Acme', 'acme',
          '2026-06-21T00:00:00.000Z', '2026-06-21T00:00:00.000Z'
        );

        INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (
          'org_acme', 'user_admin', 'admin', '2026-06-21T00:00:00.000Z'
        );
      `);

      const fkCheck = db.prepare("PRAGMA foreign_key_check").all();
      expect(fkCheck).toEqual([]);

      const member = db
        .prepare("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?")
        .get("org_acme", "user_admin") as { role: string };
      expect(member.role).toBe("admin");
    } finally {
      db.close();
    }
  });

  test("rejects duplicate organization slug", () => {
    const db = new Database(":memory:");

    try {
      migrateDatabase(db);

      db.prepare(`
        INSERT INTO organizations (
          id, name, slug, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run("org_a", "Org A", "acme", "2026-06-21T00:00:00.000Z", "2026-06-21T00:00:00.000Z");

      let error: unknown;
      try {
        db.prepare(`
          INSERT INTO organizations (
            id, name, slug, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `).run("org_b", "Org B", "acme", "2026-06-21T00:00:00.000Z", "2026-06-21T00:00:00.000Z");
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeDefined();
      expect(String(error)).toContain("UNIQUE");
    } finally {
      db.close();
    }
  });

  test("rejects org_member with unknown org_id", () => {
    const db = new Database(":memory:");

    try {
      migrateDatabase(db);

      db.prepare(`
        INSERT INTO users (
          id, email, password_hash, is_platform_admin, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run("user_1", "user@example.com", "hash", 0, "2026-06-21T00:00:00.000Z", "2026-06-21T00:00:00.000Z");

      let error: unknown;
      try {
        db.prepare(`
          INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
        `).run("missing_org", "user_1", "admin", "2026-06-21T00:00:00.000Z");
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeDefined();
      expect(String(error)).toContain("FOREIGN KEY");
    } finally {
      db.close();
    }
  });

  test("adds is_platform_admin to legacy users table", () => {
    const db = new Database(":memory:");

    try {
      db.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY NOT NULL,
          email TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      migrateDatabase(db);

      const columns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain("is_platform_admin");
    } finally {
      db.close();
    }
  });

  test("adds org_id to tenant tables and composite unique indexes", () => {
    const db = new Database(":memory:");

    try {
      migrateDatabase(db);

      for (const tableName of [
        "profiles",
        "sessions",
        "automations",
        "tasks",
        "tools",
        "mcp_servers",
        "skills",
        "llm_usage_stats",
        "workspace_settings",
      ]) {
        const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
        expect(columns.map((column) => column.name)).toContain("org_id");
      }

      const toolIndexes = db.prepare("PRAGMA index_list(tools)").all() as Array<{ name: string }>;
      expect(toolIndexes.some((index) => index.name === "tools_org_name_unique")).toBe(true);
      expect(toolIndexes.some((index) => index.name === "tools_name_unique")).toBe(false);

      db.exec(`
        INSERT INTO organizations (
          id, name, slug, created_at, updated_at
        ) VALUES
          ('org_a', 'Org A', 'org-a', '2026-06-21T00:00:00.000Z', '2026-06-21T00:00:00.000Z'),
          ('org_b', 'Org B', 'org-b', '2026-06-21T00:00:00.000Z', '2026-06-21T00:00:00.000Z');

        INSERT INTO tools (
          id, name, description, handler_type, handler_config, org_id, created_at, updated_at
        ) VALUES
          ('tool_a', 'bash', 'bash', 'bash', '{}', 'org_a', '2026-06-21T00:00:00.000Z', '2026-06-21T00:00:00.000Z'),
          ('tool_b', 'bash', 'bash', 'bash', '{}', 'org_b', '2026-06-21T00:00:00.000Z', '2026-06-21T00:00:00.000Z');
      `);

      const fkCheck = db.prepare("PRAGMA foreign_key_check").all();
      expect(fkCheck).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("creates channel_org_mappings with foreign keys", () => {
    const db = new Database(":memory:");

    try {
      migrateDatabase(db);

      db.exec(`
        INSERT INTO users (
          id, email, password_hash, is_platform_admin, created_at, updated_at
        ) VALUES (
          'user_1', 'user@example.com', 'hash', 0,
          '2026-06-21T00:00:00.000Z', '2026-06-21T00:00:00.000Z'
        );

        INSERT INTO organizations (
          id, name, slug, created_at, updated_at
        ) VALUES (
          'org_acme', 'Acme', 'acme',
          '2026-06-21T00:00:00.000Z', '2026-06-21T00:00:00.000Z'
        );

        INSERT INTO channel_org_mappings (
          channel, channel_user_id, user_id, org_id, created_at
        ) VALUES (
          'telegram', 'tg_123', 'user_1', 'org_acme', '2026-06-21T00:00:00.000Z'
        );
      `);

      const fkCheck = db.prepare("PRAGMA foreign_key_check").all();
      expect(fkCheck).toEqual([]);
    } finally {
      db.close();
    }
  });
});
