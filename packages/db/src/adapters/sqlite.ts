import { Database } from "bun:sqlite";
import type { ChatMessage } from "@tinyclaw/core";
import { getUserMessageText } from "@tinyclaw/core";
import { ensureDatabaseDirectory, resolveDatabasePath } from "../database-url";
import { migrateDatabase } from "../migrate";
import { LLM_USAGE_STATS_ID } from "../constants";
import type {
  DatabaseAdapter,
  LlmUsageStatsDelta,
  StoredAutomationRecord,
  StoredAutomationRunRecord,
  StoredLlmUsageStatsRecord,
  StoredMcpServerRecord,
  StoredProfileRecord,
  StoredSessionMessageRecord,
  StoredSessionRecord,
  StoredSessionSummaryRecord,
  StoredTaskRecord,
  StoredTaskRunRecord,
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
  title: string | null;
  agent_todos: string;
}

interface SessionMessageRow {
  id: string;
  session_id: string;
  seq: number;
  payload: string;
  created_at: string;
}

interface TaskRow {
  id: string;
  title: string;
  description: string;
  prompt: string;
  profile_id: string;
  status: string;
  position: number;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskRunRow {
  id: string;
  task_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  output: string | null;
  error: string | null;
}

interface SessionSummaryRow {
  id: string;
  profile_id: string;
  channel: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  title: string | null;
  first_user_payload: string | null;
}

interface LlmUsageStatsRow {
  id: string;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  tracked_since: string;
  updated_at: string;
}

interface McpServerRow {
  id: string;
  name: string;
  transport: string;
  config: string;
  enabled: number;
  status: string;
  last_error: string | null;
  cached_tools: string;
  created_at: string;
  updated_at: string;
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
  const updateSessionTitleStmt = db.prepare(`
    UPDATE sessions SET title = ? WHERE id = ? AND title IS NULL
  `);
  const getSessionTodosStmt = db.prepare(
    "SELECT agent_todos FROM sessions WHERE id = ?",
  );
  const updateSessionTodosStmt = db.prepare(
    "UPDATE sessions SET agent_todos = ? WHERE id = ?",
  );

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
      s.title,
      COUNT(m.id) AS message_count,
      COALESCE(MAX(m.created_at), s.created_at) AS updated_at,
      (
        SELECT payload
        FROM session_messages
        WHERE session_id = s.id
          AND json_extract(payload, '$.role') = 'user'
        ORDER BY seq ASC
        LIMIT 1
      ) AS first_user_payload
    FROM sessions s
    LEFT JOIN session_messages m ON m.session_id = s.id
    WHERE s.profile_id = ? AND s.channel = ?
    GROUP BY s.id
    HAVING COUNT(m.id) > 0
    ORDER BY updated_at DESC, s.created_at DESC
  `);

  const listTasksStmt = db.prepare("SELECT * FROM tasks ORDER BY status ASC, position ASC");
  const getTaskStmt = db.prepare("SELECT * FROM tasks WHERE id = ?");
  const upsertTaskStmt = db.prepare(`
    INSERT INTO tasks (id, title, description, prompt, profile_id, status, position, session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      prompt = excluded.prompt,
      profile_id = excluded.profile_id,
      status = excluded.status,
      position = excluded.position,
      session_id = excluded.session_id,
      updated_at = excluded.updated_at
  `);
  const deleteTaskStmt = db.prepare("DELETE FROM tasks WHERE id = ?");

  const listTaskRunsStmt = db.prepare(`
    SELECT * FROM task_runs
    WHERE task_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `);
  const getActiveTaskRunStmt = db.prepare(`
    SELECT * FROM task_runs
    WHERE task_id = ? AND status = 'running'
    ORDER BY started_at DESC
    LIMIT 1
  `);
  const insertTaskRunStmt = db.prepare(`
    INSERT INTO task_runs (id, task_id, status, started_at, completed_at, output, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const updateTaskRunStmt = db.prepare(`
    UPDATE task_runs
    SET status = ?, completed_at = ?, output = ?, error = ?
    WHERE id = ?
  `);

  const getLlmUsageStatsStmt = db.prepare(
    "SELECT * FROM llm_usage_stats WHERE id = ?",
  );
  const listMcpServersStmt = db.prepare("SELECT * FROM mcp_servers");
  const getMcpServerStmt = db.prepare("SELECT * FROM mcp_servers WHERE id = ?");
  const getMcpServerByNameStmt = db.prepare("SELECT * FROM mcp_servers WHERE name = ?");
  const upsertMcpServerStmt = db.prepare(`
    INSERT INTO mcp_servers (
      id, name, transport, config, enabled, status, last_error, cached_tools, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      transport = excluded.transport,
      config = excluded.config,
      enabled = excluded.enabled,
      status = excluded.status,
      last_error = excluded.last_error,
      cached_tools = excluded.cached_tools,
      updated_at = excluded.updated_at
  `);
  const deleteMcpServerStmt = db.prepare("DELETE FROM mcp_servers WHERE id = ?");
  const listMcpServersForProfileStmt = db.prepare(`
    SELECT mcp_servers.*
    FROM mcp_servers
    INNER JOIN profile_mcp_servers ON profile_mcp_servers.server_id = mcp_servers.id
    WHERE profile_mcp_servers.profile_id = ?
    ORDER BY mcp_servers.name ASC
  `);
  const assignMcpServerStmt = db.prepare(`
    INSERT OR IGNORE INTO profile_mcp_servers (profile_id, server_id)
    VALUES (?, ?)
  `);
  const unassignMcpServerStmt = db.prepare(`
    DELETE FROM profile_mcp_servers
    WHERE profile_id = ? AND server_id = ?
  `);
  const countProfileMcpAssignmentsStmt = db.prepare(`
    SELECT COUNT(*) AS count FROM profile_mcp_servers
  `);

  const incrementLlmUsageStatsStmt = db.prepare(`
    INSERT INTO llm_usage_stats (
      id,
      request_count,
      input_tokens,
      output_tokens,
      estimated_cost_usd,
      tracked_since,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      request_count = llm_usage_stats.request_count + excluded.request_count,
      input_tokens = llm_usage_stats.input_tokens + excluded.input_tokens,
      output_tokens = llm_usage_stats.output_tokens + excluded.output_tokens,
      estimated_cost_usd = llm_usage_stats.estimated_cost_usd + excluded.estimated_cost_usd,
      updated_at = excluded.updated_at
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

    async updateSessionTitle(sessionId, title) {
      const result = updateSessionTitleStmt.run(title, sessionId);
      return result.changes > 0;
    },

    async getSessionTodos(sessionId) {
      const row = getSessionTodosStmt.get(sessionId) as { agent_todos: string } | null;
      return row ? parseAgentTodos(row.agent_todos) : [];
    },

    async updateSessionTodos(sessionId, todos) {
      updateSessionTodosStmt.run(JSON.stringify(todos), sessionId);
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

    async listTasks() {
      return listTasksStmt.all().map((row) => toTaskRecord(row as TaskRow));
    },

    async getTask(id) {
      const row = getTaskStmt.get(id) as TaskRow | null;
      return row ? toTaskRecord(row) : null;
    },

    async upsertTask(record) {
      const existing = await this.getTask(record.id);

      upsertTaskStmt.run(
        record.id,
        record.title,
        record.description,
        record.prompt,
        record.profileId,
        record.status,
        record.position,
        record.sessionId ?? null,
        existing?.createdAt ?? record.createdAt,
        record.updatedAt,
      );
    },

    async deleteTask(id) {
      const result = deleteTaskStmt.run(id);
      return result.changes > 0;
    },

    async listTaskRuns(taskId, limit = 20) {
      return listTaskRunsStmt
        .all(taskId, limit)
        .map((row) => toTaskRunRecord(row as TaskRunRow));
    },

    async getActiveTaskRun(taskId) {
      const row = getActiveTaskRunStmt.get(taskId) as TaskRunRow | null;
      return row ? toTaskRunRecord(row) : null;
    },

    async insertTaskRun(record) {
      insertTaskRunStmt.run(
        record.id,
        record.taskId,
        record.status,
        record.startedAt,
        record.completedAt,
        record.output,
        record.error,
      );
    },

    async updateTaskRun(record) {
      updateTaskRunStmt.run(
        record.status,
        record.completedAt,
        record.output,
        record.error,
        record.id,
      );
    },

    async getLlmUsageStats() {
      const row = getLlmUsageStatsStmt.get(LLM_USAGE_STATS_ID) as LlmUsageStatsRow | null;
      return row ? toLlmUsageStatsRecord(row) : null;
    },

    async incrementLlmUsageStats(delta, trackedSince) {
      const updatedAt = new Date().toISOString();
      incrementLlmUsageStatsStmt.run(
        LLM_USAGE_STATS_ID,
        delta.requestCount,
        delta.inputTokens,
        delta.outputTokens,
        delta.estimatedCostUsd,
        trackedSince,
        updatedAt,
      );
    },

    async listMcpServers() {
      return listMcpServersStmt.all().map((row) => toMcpServerRecord(row as McpServerRow));
    },

    async getMcpServer(id) {
      const row = getMcpServerStmt.get(id) as McpServerRow | null;
      return row ? toMcpServerRecord(row) : null;
    },

    async getMcpServerByName(name) {
      const row = getMcpServerByNameStmt.get(name) as McpServerRow | null;
      return row ? toMcpServerRecord(row) : null;
    },

    async upsertMcpServer(record) {
      upsertMcpServerStmt.run(
        record.id,
        record.name,
        record.transport,
        JSON.stringify(record.config ?? {}),
        record.enabled ? 1 : 0,
        record.status,
        record.lastError,
        JSON.stringify(record.cachedTools ?? []),
        record.createdAt,
        record.updatedAt,
      );
    },

    async deleteMcpServer(id) {
      const result = deleteMcpServerStmt.run(id);
      return result.changes > 0;
    },

    async listMcpServersForProfile(profileId) {
      return listMcpServersForProfileStmt
        .all(profileId)
        .map((row) => toMcpServerRecord(row as McpServerRow));
    },

    async assignMcpServerToProfile(profileId, serverId) {
      assignMcpServerStmt.run(profileId, serverId);
    },

    async unassignMcpServerFromProfile(profileId, serverId) {
      const result = unassignMcpServerStmt.run(profileId, serverId);
      return result.changes > 0;
    },

    async countProfileMcpAssignments() {
      const row = countProfileMcpAssignmentsStmt.get() as { count: number };
      return row.count;
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

function toMcpServerRecord(row: McpServerRow): StoredMcpServerRecord {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as StoredMcpServerRecord["transport"],
    config: parseJson(row.config),
    enabled: row.enabled !== 0,
    status: row.status as StoredMcpServerRecord["status"],
    lastError: row.last_error,
    cachedTools: parseJson(row.cached_tools) as StoredMcpServerRecord["cachedTools"],
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

function parseAgentTodos(raw: string | null | undefined): StoredSessionRecord["agentTodos"] {
  if (!raw || raw.trim() === "") {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item): item is StoredSessionRecord["agentTodos"][number] =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { id?: unknown }).id === "string" &&
        typeof (item as { content?: unknown }).content === "string" &&
        typeof (item as { status?: unknown }).status === "string",
    );
  } catch {
    return [];
  }
}

function toSessionRecord(row: SessionRow): StoredSessionRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    channel: row.channel,
    createdAt: row.created_at,
    title: row.title ?? null,
    agentTodos: parseAgentTodos(row.agent_todos),
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

function toTaskRecord(row: TaskRow): StoredTaskRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    prompt: row.prompt,
    profileId: row.profile_id,
    status: row.status,
    position: row.position,
    sessionId: row.session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTaskRunRecord(row: TaskRunRow): StoredTaskRunRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status as StoredTaskRunRecord["status"],
    startedAt: row.started_at,
    completedAt: row.completed_at,
    output: row.output,
    error: row.error,
  };
}

function previewFromFirstUserPayload(payloadJson: string | null): string | null {
  if (!payloadJson) {
    return null;
  }

  try {
    const message = parseJson(payloadJson) as ChatMessage;

    if (message.role !== "user") {
      return null;
    }

    const text = getUserMessageText(message.content).trim();
    return text || (Array.isArray(message.content) ? "[image]" : null);
  } catch {
    return null;
  }
}

function toSessionSummaryRecord(row: SessionSummaryRow): StoredSessionSummaryRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    channel: row.channel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
    title: row.title ?? null,
    preview: previewFromFirstUserPayload(row.first_user_payload),
  };
}

function toLlmUsageStatsRecord(row: LlmUsageStatsRow): StoredLlmUsageStatsRecord {
  return {
    id: row.id,
    requestCount: row.request_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedCostUsd: row.estimated_cost_usd,
    trackedSince: row.tracked_since,
    updatedAt: row.updated_at,
  };
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
