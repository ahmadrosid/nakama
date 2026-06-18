import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "bun:sqlite";

export function migrateDatabase(db: Database): void {
  const schemaPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../sql/schema.sql",
  );
  const sql = readFileSync(schemaPath, "utf8");

  db.exec(sql);
  migrateProfilesTable(db);
  migrateAutomationsTable(db);
  migrateTasksTable(db);
  migrateSessionsTable(db);
  migrateMcpTables(db);
  migrateSkillsTables(db);
  migrateUsersTable(db);
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
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("profile_id")) {
    db.exec(`
      ALTER TABLE automations ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'profile_default';
    `);
  }

  if (!columnNames.has("enabled")) {
    db.exec(`
      ALTER TABLE automations ADD COLUMN enabled INTEGER DEFAULT 1 NOT NULL;
    `);
  }
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);
  `);
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
}
