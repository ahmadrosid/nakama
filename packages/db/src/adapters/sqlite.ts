import { Database } from "bun:sqlite";
import { ensureDatabaseDirectory, resolveDatabasePath } from "../database-url";
import { migrateDatabase } from "../migrate";
import type {
  DatabaseAdapter,
  StoredAutomationRecord,
  StoredAutomationRunRecord,
  StoredProfileRecord,
  StoredSessionMessageRecord,
  StoredSessionRecord,
  StoredSessionSummaryRecord,
  StoredToolRecord,
} from "../types";

export interface SqliteDatabase {
  adapter: DatabaseAdapter;
  close(): void;
}

interface AutomationRow {
  id: string;
  name: string;
  version: number;
  definition: string;
  profile_id: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface AutomationRunRow {
  id: string;
  automation_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  output: string | null;
  error: string | null;
}

interface ProfileRow {
  id: string;
  name: string;
  system_prompt: string;
  model: string | null;
  is_super: number;
  created_at: string;
  updated_at: string;
}

interface ToolRow {
  id: string;
  name: string;
  description: string;
  handler_type: string;
  handler_config: string;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  id: string;
  profile_id: string;
  channel: string;
  created_at: string;
}

interface SessionMessageRow {
  id: string;
  session_id: string;
  seq: number;
  payload: string;
  created_at: string;
}

interface SessionSummaryRow {
  id: string;
  profile_id: string;
  channel: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  preview: string | null;
}

export async function createSqliteDatabase(databaseUrl: string): Promise<SqliteDatabase> {
  const databasePath = resolveDatabasePath(databaseUrl);
  ensureDatabaseDirectory(databasePath);

  const db = new Database(databasePath, { create: true });
  migrateDatabase(db);

  return {
    adapter: createSqliteDatabaseAdapter(db),
    close() {
      db.close();
    },
  };
}

function createSqliteDatabaseAdapter(db: Database): DatabaseAdapter {
  const listAutomationsStmt = db.prepare("SELECT * FROM automations");
  const getAutomationStmt = db.prepare("SELECT * FROM automations WHERE id = ?");
  const upsertAutomationStmt = db.prepare(`
    INSERT INTO automations (id, name, version, definition, profile_id, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      version = excluded.version,
      definition = excluded.definition,
      profile_id = excluded.profile_id,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `);
  const deleteAutomationStmt = db.prepare("DELETE FROM automations WHERE id = ?");

  const listAutomationRunsStmt = db.prepare(`
    SELECT * FROM automation_runs
    WHERE automation_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `);
  const getActiveAutomationRunStmt = db.prepare(`
    SELECT * FROM automation_runs
    WHERE automation_id = ? AND status = 'running'
    ORDER BY started_at DESC
    LIMIT 1
  `);
  const insertAutomationRunStmt = db.prepare(`
    INSERT INTO automation_runs (id, automation_id, status, started_at, completed_at, output, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const updateAutomationRunStmt = db.prepare(`
    UPDATE automation_runs
    SET status = ?, completed_at = ?, output = ?, error = ?
    WHERE id = ?
  `);

  const listProfilesStmt = db.prepare("SELECT * FROM profiles");
  const getProfileStmt = db.prepare("SELECT * FROM profiles WHERE id = ?");
  const upsertProfileStmt = db.prepare(`
    INSERT INTO profiles (id, name, system_prompt, model, is_super, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      system_prompt = excluded.system_prompt,
      model = excluded.model,
      is_super = excluded.is_super,
      updated_at = excluded.updated_at
  `);
  const deleteProfileStmt = db.prepare("DELETE FROM profiles WHERE id = ?");

  const listToolsStmt = db.prepare("SELECT * FROM tools");
  const getToolStmt = db.prepare("SELECT * FROM tools WHERE id = ?");
  const getToolByNameStmt = db.prepare("SELECT * FROM tools WHERE name = ?");
  const upsertToolStmt = db.prepare(`
    INSERT INTO tools (id, name, description, handler_type, handler_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      handler_type = excluded.handler_type,
      handler_config = excluded.handler_config,
      updated_at = excluded.updated_at
  `);
  const deleteToolStmt = db.prepare("DELETE FROM tools WHERE id = ?");

  const listToolsForProfileStmt = db.prepare(`
    SELECT tools.*
    FROM profile_tools
    INNER JOIN tools ON profile_tools.tool_id = tools.id
    WHERE profile_tools.profile_id = ?
  `);
  const assignToolStmt = db.prepare(`
    INSERT INTO profile_tools (profile_id, tool_id)
    VALUES (?, ?)
    ON CONFLICT DO NOTHING
  `);
  const unassignToolStmt = db.prepare(`
    DELETE FROM profile_tools
    WHERE profile_id = ? AND tool_id = ?
  `);

  const listSessionsStmt = db.prepare("SELECT * FROM sessions");
  const getSessionStmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  const upsertSessionStmt = db.prepare(`
    INSERT INTO sessions (id, profile_id, channel, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      profile_id = excluded.profile_id,
      channel = excluded.channel
  `);
  const deleteSessionStmt = db.prepare("DELETE FROM sessions WHERE id = ?");

  const listMessagesForSessionStmt = db.prepare(`
    SELECT * FROM session_messages
    WHERE session_id = ?
    ORDER BY seq ASC
  `);
  const appendMessageStmt = db.prepare(`
    INSERT INTO session_messages (id, session_id, seq, payload, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const deleteMessagesForSessionStmt = db.prepare(
    "DELETE FROM session_messages WHERE session_id = ?",
  );
  const listSessionSummariesStmt = db.prepare(`
    SELECT
      s.id,
      s.profile_id,
      s.channel,
      s.created_at,
      COUNT(m.id) AS message_count,
      COALESCE(MAX(m.created_at), s.created_at) AS updated_at,
      (
        SELECT json_extract(payload, '$.content')
        FROM session_messages
        WHERE session_id = s.id
          AND json_extract(payload, '$.role') = 'user'
        ORDER BY seq ASC
        LIMIT 1
      ) AS preview
    FROM sessions s
    LEFT JOIN session_messages m ON m.session_id = s.id
    WHERE s.profile_id = ? AND s.channel = ?
    GROUP BY s.id
    HAVING COUNT(m.id) > 0
    ORDER BY updated_at DESC, s.created_at DESC
  `);

  return {
    async listAutomations() {
      return listAutomationsStmt.all().map((row) => toAutomationRecord(row as AutomationRow));
    },

    async getAutomation(id) {
      const row = getAutomationStmt.get(id) as AutomationRow | null;
      return row ? toAutomationRecord(row) : null;
    },

    async upsertAutomation(record) {
      const existing = await this.getAutomation(record.id);

      upsertAutomationStmt.run(
        record.id,
        record.name,
        record.version,
        JSON.stringify(record.definition),
        record.profileId,
        record.enabled ? 1 : 0,
        existing?.createdAt ?? record.createdAt,
        record.updatedAt,
      );
    },

    async deleteAutomation(id) {
      const result = deleteAutomationStmt.run(id);
      return result.changes > 0;
    },

    async listAutomationRuns(automationId, limit = 20) {
      return listAutomationRunsStmt
        .all(automationId, limit)
        .map((row) => toAutomationRunRecord(row as AutomationRunRow));
    },

    async getActiveAutomationRun(automationId) {
      const row = getActiveAutomationRunStmt.get(automationId) as AutomationRunRow | null;
      return row ? toAutomationRunRecord(row) : null;
    },

    async insertAutomationRun(record) {
      insertAutomationRunStmt.run(
        record.id,
        record.automationId,
        record.status,
        record.startedAt,
        record.completedAt,
        record.output,
        record.error,
      );
    },

    async updateAutomationRun(record) {
      updateAutomationRunStmt.run(
        record.status,
        record.completedAt,
        record.output,
        record.error,
        record.id,
      );
    },

    async listProfiles() {
      return listProfilesStmt.all().map((row) => toProfileRecord(row as ProfileRow));
    },

    async getProfile(id) {
      const row = getProfileStmt.get(id) as ProfileRow | null;
      return row ? toProfileRecord(row) : null;
    },

    async upsertProfile(record) {
      upsertProfileStmt.run(
        record.id,
        record.name,
        record.systemPrompt,
        record.model,
        record.isSuper ? 1 : 0,
        record.createdAt,
        record.updatedAt,
      );
    },

    async deleteProfile(id) {
      const result = deleteProfileStmt.run(id);
      return result.changes > 0;
    },

    async listTools() {
      return listToolsStmt.all().map((row) => toToolRecord(row as ToolRow));
    },

    async getTool(id) {
      const row = getToolStmt.get(id) as ToolRow | null;
      return row ? toToolRecord(row) : null;
    },

    async getToolByName(name) {
      const row = getToolByNameStmt.get(name) as ToolRow | null;
      return row ? toToolRecord(row) : null;
    },

    async upsertTool(record) {
      upsertToolStmt.run(
        record.id,
        record.name,
        record.description,
        record.handlerType,
        JSON.stringify(record.handlerConfig ?? {}),
        record.createdAt,
        record.updatedAt,
      );
    },

    async deleteTool(id) {
      const result = deleteToolStmt.run(id);
      return result.changes > 0;
    },

    async listToolsForProfile(profileId) {
      return listToolsForProfileStmt
        .all(profileId)
        .map((row) => toToolRecord(row as ToolRow));
    },

    async assignToolToProfile(profileId, toolId) {
      assignToolStmt.run(profileId, toolId);
    },

    async unassignToolFromProfile(profileId, toolId) {
      const result = unassignToolStmt.run(profileId, toolId);
      return result.changes > 0;
    },

    async listSessions() {
      return listSessionsStmt.all().map((row) => toSessionRecord(row as SessionRow));
    },

    async listSessionSummaries(profileId, channel) {
      return listSessionSummariesStmt
        .all(profileId, channel)
        .map((row) => toSessionSummaryRecord(row as SessionSummaryRow));
    },

    async getSession(id) {
      const row = getSessionStmt.get(id) as SessionRow | null;
      return row ? toSessionRecord(row) : null;
    },

    async upsertSession(record) {
      upsertSessionStmt.run(
        record.id,
        record.profileId,
        record.channel,
        record.createdAt,
      );
    },

    async deleteSession(id) {
      const result = deleteSessionStmt.run(id);
      return result.changes > 0;
    },

    async listMessagesForSession(sessionId) {
      return listMessagesForSessionStmt
        .all(sessionId)
        .map((row) => toSessionMessageRecord(row as SessionMessageRow));
    },

    async appendMessagesForSession(sessionId, messages) {
      for (const message of messages) {
        appendMessageStmt.run(
          message.id,
          sessionId,
          message.seq,
          JSON.stringify(message.payload),
          message.createdAt,
        );
      }
    },

    async replaceMessagesForSession(sessionId, messages) {
      deleteMessagesForSessionStmt.run(sessionId);

      for (const message of messages) {
        appendMessageStmt.run(
          message.id,
          sessionId,
          message.seq,
          JSON.stringify(message.payload),
          message.createdAt,
        );
      }
    },

    async deleteMessagesForSession(sessionId) {
      deleteMessagesForSessionStmt.run(sessionId);
    },
  };
}

function toAutomationRecord(row: AutomationRow): StoredAutomationRecord {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    definition: parseJson(row.definition),
    profileId: row.profile_id,
    enabled: row.enabled !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAutomationRunRecord(row: AutomationRunRow): StoredAutomationRunRecord {
  return {
    id: row.id,
    automationId: row.automation_id,
    status: row.status as StoredAutomationRunRecord["status"],
    startedAt: row.started_at,
    completedAt: row.completed_at,
    output: row.output,
    error: row.error,
  };
}

function toProfileRecord(row: ProfileRow): StoredProfileRecord {
  return {
    id: row.id,
    name: row.name,
    systemPrompt: row.system_prompt,
    model: row.model,
    isSuper: row.is_super !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toToolRecord(row: ToolRow): StoredToolRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    handlerType: row.handler_type,
    handlerConfig: parseJson(row.handler_config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSessionRecord(row: SessionRow): StoredSessionRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    channel: row.channel,
    createdAt: row.created_at,
  };
}

function toSessionMessageRecord(row: SessionMessageRow): StoredSessionMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    seq: row.seq,
    payload: parseJson(row.payload),
    createdAt: row.created_at,
  };
}

function toSessionSummaryRecord(row: SessionSummaryRow): StoredSessionSummaryRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    channel: row.channel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
    preview: row.preview?.trim() || null,
  };
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
