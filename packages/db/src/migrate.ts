import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "bun:sqlite";
export function migrateDatabase(db: Database): void {
  const schemaPath = resolveSchemaPath();
  const sql = readFileSync(schemaPath, "utf8");

  db.exec(sql);
  migrateProfilesTable(db);
  migrateAutomationsTable(db);
  migrateTasksTable(db);
  migrateSessionsTable(db);
  migrateMcpTables(db);
  migrateSkillsTables(db);
  migrateUsersTable(db);
  migrateOrgTables(db);
  migrateTenantOrgScope(db);
  migrateProfileOrgColumns(db);
  migrateBrowserSessionsTable(db);
  migrateLegacyProfileIds(db);
  migrateCodingDelegationSkillName(db);
  migrateWorkspaceSettingsTable(db);
  migrateLlmUsageModelStatsTable(db);
  migrateAttachmentsTable(db);
  migrateAutomationRunsTable(db);
  migrateAutomationRunReadStateTable(db);
  migrateComposioTables(db);
  migrateComposioUserConnections(db);
}

export function resolveSchemaPath(options: {
  moduleDir?: string;
  cwd?: string;
} = {}): string {
  const moduleDir = options.moduleDir ?? dirname(fileURLToPath(import.meta.url));
  const cwd = options.cwd ?? process.cwd();
  const candidates = [
    join(moduleDir, "../sql/schema.sql"),
    resolve(cwd, "packages/db/sql/schema.sql"),
    resolve(cwd, "../packages/db/sql/schema.sql"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function migrateProfilesTable(db: Database): void {
  const columns = db
    .prepare("PRAGMA table_info(profiles)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("thinking_enabled")) {
    db.exec(`
      ALTER TABLE profiles ADD COLUMN thinking_enabled INTEGER;
    `);
  }

  if (!columnNames.has("thinking_effort")) {
    db.exec(`
      ALTER TABLE profiles ADD COLUMN thinking_effort TEXT;
    `);
  }

  if (!columnNames.has("is_default")) {
    db.exec(`
      ALTER TABLE profiles ADD COLUMN is_default INTEGER DEFAULT 0 NOT NULL;
    `);
  }
}

function migrateMcpTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      transport TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER DEFAULT 1 NOT NULL,
      status TEXT NOT NULL DEFAULT 'disconnected',
      last_error TEXT,
      cached_tools TEXT DEFAULT '[]' NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS mcp_servers_name_unique ON mcp_servers (name);
    CREATE TABLE IF NOT EXISTS profile_mcp_servers (
      profile_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      PRIMARY KEY (profile_id, server_id),
      FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,
      FOREIGN KEY (server_id) REFERENCES mcp_servers (id) ON DELETE CASCADE
    );
  `);
}

function migrateSkillsTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      source_path TEXT NOT NULL,
      has_tool INTEGER DEFAULT 0 NOT NULL,
      disable_model_invocation INTEGER DEFAULT 0 NOT NULL,
      enabled INTEGER DEFAULT 1 NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    DROP INDEX IF EXISTS skills_name_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS skills_source_path_unique ON skills (source_path);
    CREATE TABLE IF NOT EXISTS profile_skills (
      profile_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      PRIMARY KEY (profile_id, skill_id),
      FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skills (id) ON DELETE CASCADE
    );
  `);
}

function migrateAutomationsTable(db: Database): void {
  const columns = db
    .prepare("PRAGMA table_info(automations)")
    .all() as Array<{ name: string; dflt_value: string | null }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("profile_id")) {
    db.exec(`
      ALTER TABLE automations ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'default';
    `);
  }

  if (!columnNames.has("enabled")) {
    db.exec(`
      ALTER TABLE automations ADD COLUMN enabled INTEGER DEFAULT 1 NOT NULL;
    `);
  }

  const refreshedColumns = db
    .prepare("PRAGMA table_info(automations)")
    .all() as Array<{ name: string; dflt_value: string | null }>;
  const profileIdColumn = refreshedColumns.find((column) => column.name === "profile_id");

  if (normalizeSqlDefaultLiteral(profileIdColumn?.dflt_value) === "profile_default") {
    recreateAutomationsTableWithDefaultProfile(db);
  }
}

function recreateAutomationsTableWithDefaultProfile(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS automations_new (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      version INTEGER NOT NULL,
      definition TEXT NOT NULL,
      profile_id TEXT NOT NULL DEFAULT 'default',
      enabled INTEGER DEFAULT 1 NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
    );

    INSERT INTO automations_new (
      id,
      name,
      version,
      definition,
      profile_id,
      enabled,
      created_at,
      updated_at
    )
    SELECT
      id,
      name,
      version,
      definition,
      profile_id,
      enabled,
      created_at,
      updated_at
    FROM automations;

    DROP TABLE automations;
    ALTER TABLE automations_new RENAME TO automations;
  `);
}

function normalizeSqlDefaultLiteral(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/^'+|'+$/g, "");
}

function migrateTasksTable(db: Database): void {
  const columns = db
    .prepare("PRAGMA table_info(tasks)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("session_id")) {
    db.exec(`
      ALTER TABLE tasks ADD COLUMN session_id TEXT REFERENCES sessions (id) ON DELETE SET NULL;
    `);
  }
}

function migrateUsersTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      phone TEXT,
      is_platform_admin INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);
  `);

  const columns = db
    .prepare("PRAGMA table_info(users)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("is_platform_admin")) {
    db.exec(`
      ALTER TABLE users ADD COLUMN is_platform_admin INTEGER DEFAULT 0 NOT NULL;
    `);
  }

  if (!columnNames.has("name")) {
    db.exec(`ALTER TABLE users ADD COLUMN name TEXT;`);
  }

  if (!columnNames.has("phone")) {
    db.exec(`ALTER TABLE users ADD COLUMN phone TEXT;`);
  }

  if (!columnNames.has("user_context")) {
    db.exec(`ALTER TABLE users ADD COLUMN user_context TEXT;`);
  }
}

function migrateLlmUsageModelStatsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_usage_model_stats (
      model_id TEXT PRIMARY KEY NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      tracked_since TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function migrateOrgTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_unique ON organizations (slug);

    CREATE TABLE IF NOT EXISTS org_members (
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      user_context TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (org_id, user_id),
      FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS org_invites (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      invited_by_user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE,
      FOREIGN KEY (invited_by_user_id) REFERENCES users (id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS org_invites_token_hash_unique ON org_invites (token_hash);
  `);

  const columns = db
    .prepare("PRAGMA table_info(org_members)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("user_context")) {
    db.exec(`ALTER TABLE org_members ADD COLUMN user_context TEXT;`);
  }
}

const TENANT_ORG_ID_TABLES = [
  "profiles",
  "sessions",
  "automations",
  "tasks",
  "tools",
  "mcp_servers",
  "skills",
  "llm_usage_stats",
  "workspace_settings",
] as const;

type TenantOrgIdTable = (typeof TENANT_ORG_ID_TABLES)[number];

const TENANT_ORG_ID_TABLE_SET = new Set<string>(TENANT_ORG_ID_TABLES);

const PROFILE_JOIN_TABLE_COLUMNS = {
  profile_tools: "tool_id",
  profile_mcp_servers: "server_id",
  profile_skills: "skill_id",
} as const;

type ProfileJoinTable = keyof typeof PROFILE_JOIN_TABLE_COLUMNS;

function quoteSqliteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll(`"`, `""`)}"`;
}

function assertTenantOrgIdTable(tableName: string): asserts tableName is TenantOrgIdTable {
  if (!TENANT_ORG_ID_TABLE_SET.has(tableName)) {
    throw new Error(`Unsupported tenant org table: ${tableName}`);
  }
}

function assertProfileJoinTarget(
  tableName: string,
  relatedColumn: string,
): asserts tableName is ProfileJoinTable & string {
  if (
    !(tableName in PROFILE_JOIN_TABLE_COLUMNS) ||
    PROFILE_JOIN_TABLE_COLUMNS[tableName as ProfileJoinTable] !== relatedColumn
  ) {
    throw new Error(`Unsupported profile join target: ${tableName}.${relatedColumn}`);
  }
}

function migrateTenantOrgScope(db: Database): void {
  for (const tableName of TENANT_ORG_ID_TABLES) {
    addOrgIdColumnIfMissing(db, tableName);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_org_mappings (
      channel TEXT NOT NULL,
      channel_user_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (channel, channel_user_id),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    DROP INDEX IF EXISTS tools_name_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS tools_org_name_unique ON tools (org_id, name);

    DROP INDEX IF EXISTS mcp_servers_name_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS mcp_servers_org_name_unique ON mcp_servers (org_id, name);

    DROP INDEX IF EXISTS skills_source_path_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS skills_org_source_path_unique ON skills (org_id, source_path);
  `);
}

function migrateProfileOrgColumns(db: Database): void {
  migrateProfilesTable(db);

  const firstOrg = db
    .prepare("SELECT id FROM organizations ORDER BY id ASC LIMIT 1")
    .get() as { id: string } | null;

  if (firstOrg) {
    db.prepare(`
      UPDATE profiles
      SET org_id = ?
      WHERE org_id IS NULL
    `).run(firstOrg.id);

    db.prepare(`
      UPDATE profiles
      SET is_default = 0
      WHERE org_id = ?
    `).run(firstOrg.id);

    const defaultProfile = db
      .prepare(`
        SELECT id FROM profiles
        WHERE org_id = ? AND id = 'default'
        LIMIT 1
      `)
      .get(firstOrg.id) as { id: string } | null;

    if (defaultProfile) {
      db.prepare(`
        UPDATE profiles SET is_default = 1 WHERE id = ?
      `).run(defaultProfile.id);
    } else {
      const anyProfile = db
        .prepare(`
          SELECT id FROM profiles WHERE org_id = ? ORDER BY created_at ASC LIMIT 1
        `)
        .get(firstOrg.id) as { id: string } | null;

      if (anyProfile) {
        db.prepare(`
          UPDATE profiles SET is_default = 1 WHERE id = ?
        `).run(anyProfile.id);
      }
    }
  } else {
    db.prepare("DELETE FROM profiles WHERE org_id IS NULL").run();
  }

  db.prepare(`
    UPDATE automations
    SET org_id = (
      SELECT org_id FROM profiles WHERE profiles.id = automations.profile_id
    )
    WHERE org_id IS NULL
  `).run();

  db.prepare(`
    UPDATE tasks
    SET org_id = (
      SELECT org_id FROM profiles WHERE profiles.id = tasks.profile_id
    )
    WHERE org_id IS NULL
  `).run();
}

export function addOrgIdColumnIfMissing(db: Database, tableName: string): void {
  assertTenantOrgIdTable(tableName);
  const quotedTableName = quoteSqliteIdentifier(tableName);
  const columns = db
    .prepare(`PRAGMA table_info(${quotedTableName})`)
    .all() as Array<{ name: string }>;

  if (columns.length === 0) {
    return;
  }

  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("org_id")) {
    // ponytail: nullable for legacy rows — no default-org backfill (see plan R13); NOT NULL enforced at adapter layer in T3+
    db.exec(`ALTER TABLE ${quotedTableName} ADD COLUMN org_id TEXT;`);
  }
}

function migrateBrowserSessionsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      session_token_hash TEXT NOT NULL,
      csrf_token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      last_used_at TEXT,
      active_org_id TEXT,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS browser_sessions_token_hash_unique
      ON browser_sessions (session_token_hash);
  `);

  const columns = db
    .prepare("PRAGMA table_info(browser_sessions)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("active_org_id")) {
    db.exec(`ALTER TABLE browser_sessions ADD COLUMN active_org_id TEXT;`);
  }
}

const LEGACY_PROFILE_ID_MAP = [
  ["profile_default", "default"],
  ["profile_super_bot", "super_bot"],
] as const;

function migrateLegacyProfileIds(db: Database): void {
  const rows = db.prepare("SELECT id FROM profiles").all() as Array<{ id: string }>;
  const existingIds = new Set(rows.map((row) => row.id));
  const pending = LEGACY_PROFILE_ID_MAP.filter(([legacyId]) => existingIds.has(legacyId));

  if (pending.length === 0) {
    return;
  }

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");

  try {
    for (const [legacyId, canonicalId] of pending) {
      copyProfileRow(db, legacyId, canonicalId);
      moveProfileReferences(db, legacyId, canonicalId);
      db.prepare("DELETE FROM profiles WHERE id = ?").run(legacyId);
    }

    const violations = db.prepare("PRAGMA foreign_key_check").all() as Array<unknown>;

    if (violations.length > 0) {
      throw new Error("Legacy profile ID migration left foreign key violations.");
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

export function migrateCodingDelegationSkillName(db: Database): void {
  const legacyRows = db
    .prepare("SELECT id, source_path FROM skills WHERE name = ?")
    .all("coding-delegation") as Array<{ id: string; source_path: string }>;

  if (legacyRows.length === 0) {
    return;
  }

  const canonical = db
    .prepare("SELECT id FROM skills WHERE name = ?")
    .get("coding-agent") as { id: string } | null;

  if (canonical) {
    const reassignProfileSkill = db.prepare(`
      UPDATE profile_skills
      SET skill_id = ?
      WHERE skill_id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM profile_skills existing
          WHERE existing.profile_id = profile_skills.profile_id
            AND existing.skill_id = ?
        )
    `);
    const deleteProfileSkill = db.prepare(
      "DELETE FROM profile_skills WHERE skill_id = ?",
    );
    const deleteSkill = db.prepare("DELETE FROM skills WHERE id = ?");

    for (const row of legacyRows) {
      reassignProfileSkill.run(canonical.id, row.id, canonical.id);
      deleteProfileSkill.run(row.id);
      deleteSkill.run(row.id);
    }

    return;
  }

  const now = new Date().toISOString();
  const update = db.prepare(`
    UPDATE skills
    SET name = ?, source_path = ?, updated_at = ?
    WHERE id = ?
  `);

  for (const row of legacyRows) {
    update.run(
      "coding-agent",
      row.source_path.replaceAll("coding-delegation", "coding-agent"),
      now,
      row.id,
    );
  }
}

function copyProfileRow(db: Database, legacyId: string, canonicalId: string): void {
  db.prepare(`
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
    )
    SELECT
      ?,
      name,
      system_prompt,
      model,
      thinking_enabled,
      thinking_effort,
      is_super,
      created_at,
      updated_at
    FROM profiles
    WHERE id = ?
    ON CONFLICT(id) DO NOTHING
  `).run(canonicalId, legacyId);
}

function moveProfileReferences(db: Database, legacyId: string, canonicalId: string): void {
  db.prepare("UPDATE automations SET profile_id = ? WHERE profile_id = ?").run(
    canonicalId,
    legacyId,
  );
  db.prepare("UPDATE sessions SET profile_id = ? WHERE profile_id = ?").run(
    canonicalId,
    legacyId,
  );
  db.prepare("UPDATE tasks SET profile_id = ? WHERE profile_id = ?").run(
    canonicalId,
    legacyId,
  );

  moveProfileJoinReferences(db, "profile_tools", "tool_id", legacyId, canonicalId);
  moveProfileJoinReferences(db, "profile_mcp_servers", "server_id", legacyId, canonicalId);
  moveProfileJoinReferences(db, "profile_skills", "skill_id", legacyId, canonicalId);
}

export function moveProfileJoinReferences(
  db: Database,
  tableName: "profile_tools" | "profile_mcp_servers" | "profile_skills",
  relatedColumn: "tool_id" | "server_id" | "skill_id",
  legacyId: string,
  canonicalId: string,
): void {
  assertProfileJoinTarget(tableName, relatedColumn);
  const quotedTableName = quoteSqliteIdentifier(tableName);
  const quotedRelatedColumn = quoteSqliteIdentifier(relatedColumn);
  db.prepare(`
    INSERT OR IGNORE INTO ${quotedTableName} (profile_id, ${quotedRelatedColumn})
    SELECT ?, ${quotedRelatedColumn}
    FROM ${quotedTableName}
    WHERE profile_id = ?
  `).run(canonicalId, legacyId);

  db.prepare(`DELETE FROM ${quotedTableName} WHERE profile_id = ?`).run(legacyId);
}

function migrateSessionsTable(db: Database): void {
  const columns = db
    .prepare("PRAGMA table_info(sessions)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("title")) {
    db.exec(`
      ALTER TABLE sessions ADD COLUMN title TEXT;
    `);
  }

  if (!columnNames.has("agent_todos")) {
    db.exec(`
      ALTER TABLE sessions ADD COLUMN agent_todos TEXT DEFAULT '[]' NOT NULL;
    `);
  }

  if (!columnNames.has("agent_questionnaire")) {
    db.exec(`
      ALTER TABLE sessions ADD COLUMN agent_questionnaire TEXT;
    `);
  }

  if (!columnNames.has("user_id")) {
    db.exec(`
      ALTER TABLE sessions ADD COLUMN user_id TEXT REFERENCES users (id) ON DELETE SET NULL;
    `);
  }
}

function migrateWorkspaceSettingsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_settings (
      id TEXT PRIMARY KEY NOT NULL,
      vision_model TEXT,
      transcription_model TEXT,
      coding_agent_harnesses TEXT NOT NULL DEFAULT '[]',
      selected_coding_agent_harness TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  const columns = db
    .prepare("PRAGMA table_info(workspace_settings)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("transcription_model")) {
    db.exec(`
      ALTER TABLE workspace_settings ADD COLUMN transcription_model TEXT;
    `);
  }

  if (!columnNames.has("coding_agent_harnesses")) {
    db.exec(`
      ALTER TABLE workspace_settings ADD COLUMN coding_agent_harnesses TEXT NOT NULL DEFAULT '[]';
    `);
  }

  if (!columnNames.has("selected_coding_agent_harness")) {
    db.exec(`
      ALTER TABLE workspace_settings ADD COLUMN selected_coding_agent_harness TEXT;
    `);
  }
}

function migrateAutomationRunsTable(db: Database): void {
  const columns = db
    .prepare("PRAGMA table_info(automation_runs)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("delivery_status")) {
    db.exec(`
      ALTER TABLE automation_runs ADD COLUMN delivery_status TEXT;
    `);
  }

  if (!columnNames.has("delivery_error")) {
    db.exec(`
      ALTER TABLE automation_runs ADD COLUMN delivery_error TEXT;
    `);
  }
}

function migrateAutomationRunReadStateTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS automation_run_read_state (
      user_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      automation_id TEXT NOT NULL,
      read_through_at TEXT NOT NULL,
      PRIMARY KEY (user_id, org_id, automation_id),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE,
      FOREIGN KEY (automation_id) REFERENCES automations (id) ON DELETE CASCADE
    );
  `);
}

function migrateAttachmentsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT,
      profile_id TEXT NOT NULL,
      session_id TEXT,
      channel TEXT NOT NULL,
      kind TEXT NOT NULL,
      filename TEXT,
      media_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE SET NULL
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS attachments_session_id ON attachments (session_id);
  `);
}

function migrateComposioUserConnections(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS composio_user_connections (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      toolkit_id TEXT NOT NULL,
      status TEXT NOT NULL,
      connected_account_id TEXT,
      session_id_enc TEXT,
      oauth_state_hash TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (toolkit_id) REFERENCES composio_toolkits (id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS composio_user_connections_user_toolkit_unique
      ON composio_user_connections (user_id, toolkit_id);

    CREATE INDEX IF NOT EXISTS composio_user_connections_org_user
      ON composio_user_connections (org_id, user_id);
  `);

  const legacyToolkits = db
    .prepare(
      `
      SELECT
        id,
        org_id,
        status,
        connected_account_id,
        session_id_enc,
        oauth_state_hash,
        last_error,
        created_at,
        updated_at
      FROM composio_toolkits
      WHERE status IN ('connected', 'oauth_in_progress', 'error')
         OR connected_account_id IS NOT NULL
         OR oauth_state_hash IS NOT NULL
         OR session_id_enc IS NOT NULL
    `,
    )
    .all() as Array<{
    id: string;
    org_id: string;
    status: string;
    connected_account_id: string | null;
    session_id_enc: string | null;
    oauth_state_hash: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  }>;

  const findAdminStmt = db.prepare(`
    SELECT user_id
    FROM org_members
    WHERE org_id = ? AND role = 'admin'
    ORDER BY created_at ASC
    LIMIT 1
  `);
  const existingConnectionStmt = db.prepare(`
    SELECT id FROM composio_user_connections WHERE toolkit_id = ? LIMIT 1
  `);
  const insertConnectionStmt = db.prepare(`
    INSERT INTO composio_user_connections (
      id,
      org_id,
      user_id,
      toolkit_id,
      status,
      connected_account_id,
      session_id_enc,
      oauth_state_hash,
      last_error,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const normalizeToolkitStmt = db.prepare(`
    UPDATE composio_toolkits
    SET
      status = CASE WHEN status = 'disabled' THEN 'disabled' ELSE 'enabled' END,
      connected_account_id = NULL,
      session_id_enc = NULL,
      oauth_state_hash = NULL,
      updated_at = ?
    WHERE id = ?
  `);

  const now = new Date().toISOString();

  for (const toolkit of legacyToolkits) {
    if (existingConnectionStmt.get(toolkit.id)) {
      normalizeToolkitStmt.run(now, toolkit.id);
      continue;
    }

    const adminRow = findAdminStmt.get(toolkit.org_id) as { user_id: string } | null;
    if (!adminRow?.user_id) {
      normalizeToolkitStmt.run(now, toolkit.id);
      continue;
    }

    const connectionStatus =
      toolkit.status === "oauth_in_progress"
        ? "oauth_in_progress"
        : toolkit.status === "error"
          ? "error"
          : "connected";

    insertConnectionStmt.run(
      `cuc_${toolkit.id}`,
      toolkit.org_id,
      adminRow.user_id,
      toolkit.id,
      connectionStatus,
      toolkit.connected_account_id,
      toolkit.session_id_enc,
      toolkit.oauth_state_hash,
      toolkit.last_error,
      toolkit.created_at,
      toolkit.updated_at,
    );

    normalizeToolkitStmt.run(now, toolkit.id);
  }
}

function migrateComposioTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS composio_toolkits (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      toolkit_slug TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL,
      connected_account_id TEXT,
      session_id_enc TEXT,
      oauth_state_hash TEXT,
      cached_tools TEXT NOT NULL DEFAULT '[]',
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS composio_toolkits_org_slug_unique
      ON composio_toolkits (org_id, toolkit_slug);

    CREATE INDEX IF NOT EXISTS composio_toolkits_org_id
      ON composio_toolkits (org_id);

    CREATE TABLE IF NOT EXISTS profile_composio_toolkits (
      profile_id TEXT NOT NULL,
      toolkit_id TEXT NOT NULL,
      allowed_actions TEXT,
      PRIMARY KEY (profile_id, toolkit_id),
      FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,
      FOREIGN KEY (toolkit_id) REFERENCES composio_toolkits (id) ON DELETE CASCADE
    );
  `);
}
