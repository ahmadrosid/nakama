import { Database } from "bun:sqlite";
import type { AgentQuestionnaire, ChatMessage } from "@nakama/core";
import { getUserMessageText } from "@nakama/core";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import { ensureDatabaseDirectory, resolveDatabasePath } from "../database-url";
import { migrateDatabase } from "../migrate";
import { LLM_USAGE_STATS_ID, WORKSPACE_SETTINGS_ID } from "../constants";
import type {
  DatabaseAdapter,
  StoredBrowserSessionRecord,
  StoredAutomationRecord,
  StoredAutomationRunRecord,
  StoredLlmUsageModelStatsRecord,
  StoredLlmUsageStatsRecord,
  StoredMcpServerRecord,
  StoredSkillRecord,
  StoredOrgMemberRecord,
  StoredOrgInviteRecord,
  StoredOrganizationRecord,
  StoredUserOrganizationRecord,
  StoredProfileRecord,
  StoredAttachmentRecord,
  StoredSessionMessageRecord,
  StoredSessionRecord,
  StoredSessionSummaryRecord,
  StoredTaskRecord,
  StoredTaskRunRecord,
  StoredToolRecord,
  StoredUserRecord,
  StoredNotificationDestinationRecord,
  StoredComposioToolkitRecord,
  StoredProfileComposioToolkitRecord,
  StoredWorkspaceSettingsRecord,
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
  org_id: string | null;
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
  delivery_status: string | null;
  delivery_error: string | null;
}

interface ProfileRow {
  id: string;
  name: string;
  system_prompt: string;
  model: string | null;
  thinking_enabled: number | null;
  thinking_effort: string | null;
  is_super: number;
  org_id: string | null;
  is_default: number;
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
  user_id?: string | null;
  created_at: string;
  title: string | null;
  agent_todos: string;
  agent_questionnaire: string | null;
}

interface SessionMessageRow {
  id: string;
  session_id: string;
  seq: number;
  payload: string;
  created_at: string;
}

interface AttachmentRow {
  id: string;
  org_id: string | null;
  profile_id: string;
  session_id: string | null;
  channel: string;
  kind: string;
  filename: string | null;
  media_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

interface TaskRow {
  id: string;
  title: string;
  description: string;
  prompt: string;
  profile_id: string;
  org_id: string | null;
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

interface LlmUsageModelStatsRow {
  model_id: string;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  tracked_since: string;
  updated_at: string;
}

interface WorkspaceSettingsRow {
  id: string;
  vision_model: string | null;
  transcription_model: string | null;
  coding_agent_harnesses: string;
  selected_coding_agent_harness: string | null;
  updated_at: string;
}

interface NotificationDestinationRow {
  id: string;
  name: string;
  channel: "telegram";
  config: string;
  secret_hash: string;
  org_id: string;
  created_at: string;
  updated_at: string;
}

interface ComposioToolkitRow {
  id: string;
  org_id: string;
  toolkit_slug: string;
  display_name: string;
  status: string;
  connected_account_id: string | null;
  session_id_enc: string | null;
  oauth_state_hash: string | null;
  cached_tools: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface ProfileComposioToolkitRow {
  profile_id: string;
  toolkit_id: string;
  allowed_actions: string | null;
}

interface SkillRow {
  id: string;
  name: string;
  description: string;
  source_path: string;
  has_tool: number;
  disable_model_invocation: number;
  enabled: number;
  created_at: string;
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

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name?: string | null;
  phone?: string | null;
  is_platform_admin?: number | null;
  user_context?: string | null;
  created_at: string;
  updated_at: string;
}

interface BrowserSessionRow {
  id: string;
  user_id: string;
  session_token_hash: string;
  csrf_token_hash: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  active_org_id?: string | null;
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

interface OrgInviteRow {
  id: string;
  org_id: string;
  email: string;
  role: string;
  token_hash: string;
  invited_by_user_id: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
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
  const listAutomationsForOrgStmt = db.prepare(
    "SELECT * FROM automations WHERE org_id = ? ORDER BY updated_at DESC",
  );
  const getAutomationStmt = db.prepare("SELECT * FROM automations WHERE id = ?");
  const upsertAutomationStmt = db.prepare(`
    INSERT INTO automations (id, name, version, definition, profile_id, org_id, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      version = excluded.version,
      definition = excluded.definition,
      profile_id = excluded.profile_id,
      org_id = excluded.org_id,
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
    INSERT INTO automation_runs (id, automation_id, status, started_at, completed_at, output, error, delivery_status, delivery_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateAutomationRunStmt = db.prepare(`
    UPDATE automation_runs
    SET status = ?, completed_at = ?, output = ?, error = ?, delivery_status = ?, delivery_error = ?
    WHERE id = ?
  `);
  const deleteAutomationRunStmt = db.prepare(`
    DELETE FROM automation_runs
    WHERE automation_id = ? AND id = ?
  `);

  const getAutomationRunReadThroughStmt = db.prepare(`
    SELECT read_through_at
    FROM automation_run_read_state
    WHERE user_id = ? AND org_id = ? AND automation_id = ?
  `);
  const upsertAutomationRunReadThroughStmt = db.prepare(`
    INSERT INTO automation_run_read_state (user_id, org_id, automation_id, read_through_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, org_id, automation_id) DO UPDATE SET
      read_through_at = excluded.read_through_at
  `);
  const countUnreadAutomationRunsByOrgStmt = db.prepare(`
    SELECT ar.automation_id AS automation_id, COUNT(*) AS unread_count
    FROM automation_runs ar
    INNER JOIN automations a ON a.id = ar.automation_id
    LEFT JOIN automation_run_read_state rs
      ON rs.automation_id = ar.automation_id
      AND rs.user_id = ?
      AND rs.org_id = ?
    WHERE a.org_id = ?
      AND ar.status IN ('completed', 'failed')
      AND COALESCE(ar.completed_at, ar.started_at) > COALESCE(rs.read_through_at, '1970-01-01T00:00:00.000Z')
    GROUP BY ar.automation_id
  `);

  const listProfilesStmt = db.prepare("SELECT * FROM profiles");
  const listProfilesForOrgStmt = db.prepare(
    "SELECT * FROM profiles WHERE org_id = ? ORDER BY is_default DESC, name ASC",
  );
  const getProfileStmt = db.prepare("SELECT * FROM profiles WHERE id = ?");
  const getProfileForOrgStmt = db.prepare(
    "SELECT * FROM profiles WHERE id = ? AND org_id = ?",
  );
  const getDefaultProfileForOrgStmt = db.prepare(
    "SELECT * FROM profiles WHERE org_id = ? AND is_default = 1 LIMIT 1",
  );
  const clearDefaultProfileForOrgStmt = db.prepare(`
    UPDATE profiles SET is_default = 0 WHERE org_id = ? AND id != ?
  `);
  const upsertProfileStmt = db.prepare(`
    INSERT INTO profiles (
      id,
      name,
      system_prompt,
      model,
      thinking_enabled,
      thinking_effort,
      is_super,
      org_id,
      is_default,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      system_prompt = excluded.system_prompt,
      model = excluded.model,
      thinking_enabled = excluded.thinking_enabled,
      thinking_effort = excluded.thinking_effort,
      is_super = excluded.is_super,
      org_id = excluded.org_id,
      is_default = excluded.is_default,
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
    INSERT INTO sessions (id, profile_id, channel, created_at, user_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      profile_id = excluded.profile_id,
      channel = excluded.channel,
      user_id = COALESCE(excluded.user_id, sessions.user_id)
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
  const getSessionQuestionnaireStmt = db.prepare(
    "SELECT agent_questionnaire FROM sessions WHERE id = ?",
  );
  const updateSessionQuestionnaireStmt = db.prepare(
    "UPDATE sessions SET agent_questionnaire = ? WHERE id = ?",
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
  const insertAttachmentStmt = db.prepare(`
    INSERT INTO attachments (
      id, org_id, profile_id, session_id, channel, kind, filename,
      media_type, size_bytes, storage_path, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getAttachmentStmt = db.prepare("SELECT * FROM attachments WHERE id = ?");
  const deleteAttachmentStmt = db.prepare("DELETE FROM attachments WHERE id = ?");
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
  const listTasksForOrgStmt = db.prepare(`
    SELECT * FROM tasks
    WHERE org_id = ?
    ORDER BY status ASC, position ASC
  `);
  const getTaskStmt = db.prepare("SELECT * FROM tasks WHERE id = ?");
  const upsertTaskStmt = db.prepare(`
    INSERT INTO tasks (id, title, description, prompt, profile_id, org_id, status, position, session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      prompt = excluded.prompt,
      profile_id = excluded.profile_id,
      org_id = excluded.org_id,
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
  const listLlmUsageStatsByModelStmt = db.prepare(`
    SELECT * FROM llm_usage_model_stats
    ORDER BY request_count DESC, input_tokens + output_tokens DESC, model_id ASC
  `);
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
  const listProfilesForMcpServerStmt = db.prepare(`
    SELECT profiles.*
    FROM profiles
    INNER JOIN profile_mcp_servers ON profile_mcp_servers.profile_id = profiles.id
    WHERE profile_mcp_servers.server_id = ?
    ORDER BY profiles.name ASC
  `);
  const listMcpServerProfileCountsStmt = db.prepare(`
    SELECT server_id, COUNT(*) AS count
    FROM profile_mcp_servers
    GROUP BY server_id
  `);

  const listSkillsStmt = db.prepare("SELECT * FROM skills ORDER BY name ASC");
  const getSkillStmt = db.prepare("SELECT * FROM skills WHERE id = ?");
  const getSkillByNameStmt = db.prepare("SELECT * FROM skills WHERE name = ?");
  const getSkillBySourcePathStmt = db.prepare("SELECT * FROM skills WHERE source_path = ?");
  const upsertSkillStmt = db.prepare(`
    INSERT INTO skills (
      id, name, description, source_path, has_tool, disable_model_invocation, enabled, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      source_path = excluded.source_path,
      has_tool = excluded.has_tool,
      disable_model_invocation = excluded.disable_model_invocation,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `);
  const deleteSkillStmt = db.prepare("DELETE FROM skills WHERE id = ?");
  const listSkillsForProfileStmt = db.prepare(`
    SELECT skills.*
    FROM skills
    INNER JOIN profile_skills ON profile_skills.skill_id = skills.id
    WHERE profile_skills.profile_id = ?
    ORDER BY skills.name ASC
  `);
  const assignSkillStmt = db.prepare(`
    INSERT OR IGNORE INTO profile_skills (profile_id, skill_id)
    VALUES (?, ?)
  `);
  const unassignSkillStmt = db.prepare(`
    DELETE FROM profile_skills
    WHERE profile_id = ? AND skill_id = ?
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
  const incrementLlmUsageStatsByModelStmt = db.prepare(`
    INSERT INTO llm_usage_model_stats (
      model_id,
      request_count,
      input_tokens,
      output_tokens,
      estimated_cost_usd,
      tracked_since,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(model_id) DO UPDATE SET
      request_count = llm_usage_model_stats.request_count + excluded.request_count,
      input_tokens = llm_usage_model_stats.input_tokens + excluded.input_tokens,
      output_tokens = llm_usage_model_stats.output_tokens + excluded.output_tokens,
      estimated_cost_usd = llm_usage_model_stats.estimated_cost_usd + excluded.estimated_cost_usd,
      updated_at = excluded.updated_at
  `);
  const getWorkspaceSettingsStmt = db.prepare(
    "SELECT * FROM workspace_settings WHERE id = ?",
  );
  const upsertWorkspaceSettingsStmt = db.prepare(`
    INSERT INTO workspace_settings (
      id,
      vision_model,
      transcription_model,
      coding_agent_harnesses,
      selected_coding_agent_harness,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      vision_model = excluded.vision_model,
      transcription_model = excluded.transcription_model,
      coding_agent_harnesses = excluded.coding_agent_harnesses,
      selected_coding_agent_harness = excluded.selected_coding_agent_harness,
      updated_at = excluded.updated_at
  `);
  const listNotificationDestinationsForOrgStmt = db.prepare(`
    SELECT id, name, channel, config, secret_hash, org_id, created_at, updated_at
    FROM notification_destinations
    WHERE org_id = ?
    ORDER BY created_at DESC
  `);
  const getNotificationDestinationStmt = db.prepare(`
    SELECT id, name, channel, config, secret_hash, org_id, created_at, updated_at
    FROM notification_destinations
    WHERE id = ?
  `);
  const upsertNotificationDestinationStmt = db.prepare(`
    INSERT INTO notification_destinations (
      id,
      name,
      channel,
      config,
      secret_hash,
      org_id,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      channel = excluded.channel,
      config = excluded.config,
      secret_hash = excluded.secret_hash,
      org_id = excluded.org_id,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);
  const deleteNotificationDestinationStmt = db.prepare(`
    DELETE FROM notification_destinations WHERE id = ?
  `);
  const listComposioToolkitsForOrgStmt = db.prepare(`
    SELECT
      id,
      org_id,
      toolkit_slug,
      display_name,
      status,
      connected_account_id,
      session_id_enc,
      oauth_state_hash,
      cached_tools,
      last_error,
      created_at,
      updated_at
    FROM composio_toolkits
    WHERE org_id = ?
    ORDER BY display_name ASC
  `);
  const getComposioToolkitStmt = db.prepare(`
    SELECT
      id,
      org_id,
      toolkit_slug,
      display_name,
      status,
      connected_account_id,
      session_id_enc,
      oauth_state_hash,
      cached_tools,
      last_error,
      created_at,
      updated_at
    FROM composio_toolkits
    WHERE id = ?
  `);
  const getComposioToolkitBySlugStmt = db.prepare(`
    SELECT
      id,
      org_id,
      toolkit_slug,
      display_name,
      status,
      connected_account_id,
      session_id_enc,
      oauth_state_hash,
      cached_tools,
      last_error,
      created_at,
      updated_at
    FROM composio_toolkits
    WHERE org_id = ? AND toolkit_slug = ?
  `);
  const upsertComposioToolkitStmt = db.prepare(`
    INSERT INTO composio_toolkits (
      id,
      org_id,
      toolkit_slug,
      display_name,
      status,
      connected_account_id,
      session_id_enc,
      oauth_state_hash,
      cached_tools,
      last_error,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      org_id = excluded.org_id,
      toolkit_slug = excluded.toolkit_slug,
      display_name = excluded.display_name,
      status = excluded.status,
      connected_account_id = excluded.connected_account_id,
      session_id_enc = excluded.session_id_enc,
      oauth_state_hash = excluded.oauth_state_hash,
      cached_tools = excluded.cached_tools,
      last_error = excluded.last_error,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);
  const deleteComposioToolkitStmt = db.prepare(`
    DELETE FROM composio_toolkits WHERE id = ?
  `);
  const listProfileComposioToolkitsStmt = db.prepare(`
    SELECT profile_id, toolkit_id, allowed_actions
    FROM profile_composio_toolkits
    WHERE profile_id = ?
  `);
  const deleteProfileComposioToolkitsStmt = db.prepare(`
    DELETE FROM profile_composio_toolkits WHERE profile_id = ?
  `);
  const insertProfileComposioToolkitStmt = db.prepare(`
    INSERT INTO profile_composio_toolkits (profile_id, toolkit_id, allowed_actions)
    VALUES (?, ?, ?)
  `);

  const getUserByEmailStmt = db.prepare("SELECT * FROM users WHERE email = ?");
  const getUserByIdStmt = db.prepare("SELECT * FROM users WHERE id = ?");
  const createUserStmt = db.prepare(`
    INSERT INTO users (
      id, email, password_hash, name, phone, is_platform_admin, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateUserProfileStmt = db.prepare(`
    UPDATE users
    SET name = ?, phone = ?, updated_at = ?
    WHERE id = ?
  `);
  const updateUserPasswordStmt = db.prepare(`
    UPDATE users
    SET password_hash = ?, updated_at = ?
    WHERE id = ?
  `);
  const getUserContextStmt = db.prepare(`
    SELECT COALESCE(om.user_context, u.user_context) AS user_context
    FROM org_members om
    INNER JOIN users u ON u.id = om.user_id
    WHERE om.org_id = ? AND om.user_id = ?
  `);
  const setUserContextStmt = db.prepare(`
    UPDATE org_members
    SET user_context = ?
    WHERE org_id = ? AND user_id = ?
  `);
  const countUsersStmt = db.prepare("SELECT COUNT(*) as count FROM users");
  const countHumanUsersStmt = db.prepare(
    "SELECT COUNT(*) as count FROM users WHERE id != ?",
  );

  const createBrowserSessionStmt = db.prepare(`
    INSERT INTO browser_sessions (
      id,
      user_id,
      session_token_hash,
      csrf_token_hash,
      created_at,
      expires_at,
      revoked_at,
      last_used_at,
      active_org_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getBrowserSessionByTokenHashStmt = db.prepare(`
    SELECT * FROM browser_sessions
    WHERE session_token_hash = ?
    LIMIT 1
  `);
  const revokeBrowserSessionByTokenHashStmt = db.prepare(`
    UPDATE browser_sessions
    SET revoked_at = ?
    WHERE session_token_hash = ? AND revoked_at IS NULL
  `);
  const updateBrowserSessionLastUsedAtStmt = db.prepare(`
    UPDATE browser_sessions
    SET last_used_at = ?
    WHERE id = ?
  `);
  const updateBrowserSessionActiveOrgIdStmt = db.prepare(`
    UPDATE browser_sessions
    SET active_org_id = ?
    WHERE id = ?
  `);
  const upsertOrganizationStmt = db.prepare(`
    INSERT INTO organizations (id, name, slug, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      slug = excluded.slug,
      updated_at = excluded.updated_at
  `);
  const listOrganizationsStmt = db.prepare(`
    SELECT id, name, slug, created_at, updated_at
    FROM organizations
    ORDER BY name ASC
  `);
  const getOrganizationBySlugStmt = db.prepare(`
    SELECT id, name, slug, created_at, updated_at
    FROM organizations
    WHERE slug = ?
    LIMIT 1
  `);
  const getOrganizationByIdStmt = db.prepare(`
    SELECT id, name, slug, created_at, updated_at
    FROM organizations
    WHERE id = ?
    LIMIT 1
  `);
  const createOrgInviteStmt = db.prepare(`
    INSERT INTO org_invites (
      id, org_id, email, role, token_hash, invited_by_user_id,
      expires_at, accepted_at, revoked_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getOrgInviteByTokenHashStmt = db.prepare(`
    SELECT
      id, org_id, email, role, token_hash, invited_by_user_id,
      expires_at, accepted_at, revoked_at, created_at
    FROM org_invites
    WHERE token_hash = ?
    LIMIT 1
  `);
  const getPendingOrgInviteStmt = db.prepare(`
    SELECT
      id, org_id, email, role, token_hash, invited_by_user_id,
      expires_at, accepted_at, revoked_at, created_at
    FROM org_invites
    WHERE org_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL
    LIMIT 1
  `);
  const markOrgInviteAcceptedStmt = db.prepare(`
    UPDATE org_invites
    SET accepted_at = ?
    WHERE id = ?
  `);
  const getOrgMemberStmt = db.prepare(`
    SELECT org_id, user_id, role, user_context, created_at
    FROM org_members
    WHERE org_id = ? AND user_id = ?
    LIMIT 1
  `);
  const upsertOrgMemberStmt = db.prepare(`
    INSERT INTO org_members (org_id, user_id, role, user_context, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(org_id, user_id) DO UPDATE SET
      role = excluded.role
  `);
  const listOrgMembersStmt = db.prepare(`
    SELECT org_id, user_id, role, user_context, created_at
    FROM org_members
    WHERE org_id = ?
    ORDER BY created_at ASC
  `);
  const listUserOrganizationsStmt = db.prepare(`
    SELECT
      o.id,
      o.name,
      o.slug,
      o.created_at,
      o.updated_at,
      om.role,
      om.created_at AS joined_at
    FROM org_members om
    INNER JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = ?
    ORDER BY o.name ASC
  `);
  const deleteOrgMemberStmt = db.prepare(`
    DELETE FROM org_members
    WHERE org_id = ? AND user_id = ?
  `);

  return {
    async getUserByEmail(email) {
      const row = getUserByEmailStmt.get(email) as UserRow | null;
      return row ? toUserRecord(row) : null;
    },

    async getUserById(id) {
      const row = getUserByIdStmt.get(id) as UserRow | null;
      return row ? toUserRecord(row) : null;
    },

    async createUser(record) {
      createUserStmt.run(
        record.id,
        record.email,
        record.passwordHash,
        record.name ?? null,
        record.phone ?? null,
        record.isPlatformAdmin ? 1 : 0,
        record.createdAt,
        record.updatedAt,
      );
    },

    async updateUserProfile(id, profile, updatedAt) {
      updateUserProfileStmt.run(profile.name, profile.phone, updatedAt, id);
    },

    async updateUserPassword(id, passwordHash, updatedAt) {
      updateUserPasswordStmt.run(passwordHash, updatedAt, id);
    },

    async getUserContext(orgId, userId) {
      const row = getUserContextStmt.get(orgId, userId) as { user_context?: string | null } | null;
      return row?.user_context ?? null;
    },

    async setUserContext(orgId, userId, content, _updatedAt) {
      setUserContextStmt.run(content, orgId, userId);
    },

    async countUsers() {
      const row = countUsersStmt.get() as { count: number };
      return row.count;
    },

    async countHumanUsers() {
      const row = countHumanUsersStmt.get(LOCAL_CLIENT_USER_ID) as { count: number };
      return row.count;
    },

    async createBrowserSession(record) {
      createBrowserSessionStmt.run(
        record.id,
        record.userId,
        record.sessionTokenHash,
        record.csrfTokenHash,
        record.createdAt,
        record.expiresAt,
        record.revokedAt,
        record.lastUsedAt,
        record.activeOrgId ?? null,
      );
    },

    async getBrowserSessionBySessionTokenHash(sessionTokenHash) {
      const row = getBrowserSessionByTokenHashStmt.get(sessionTokenHash) as BrowserSessionRow | null;
      return row ? toBrowserSessionRecord(row) : null;
    },

    async revokeBrowserSessionBySessionTokenHash(sessionTokenHash, revokedAt) {
      const result = revokeBrowserSessionByTokenHashStmt.run(revokedAt, sessionTokenHash);
      return result.changes > 0;
    },

    async updateBrowserSessionLastUsedAt(id, lastUsedAt) {
      updateBrowserSessionLastUsedAtStmt.run(lastUsedAt, id);
    },

    async updateBrowserSessionActiveOrgId(id, activeOrgId) {
      updateBrowserSessionActiveOrgIdStmt.run(activeOrgId, id);
    },

    async upsertOrganization(record) {
      upsertOrganizationStmt.run(
        record.id,
        record.name,
        record.slug,
        record.createdAt,
        record.updatedAt,
      );
    },

    async listOrganizations() {
      return listOrganizationsStmt.all().map((row) => toOrganizationRecord(row as OrganizationRow));
    },

    async getOrganizationBySlug(slug) {
      const row = getOrganizationBySlugStmt.get(slug) as OrganizationRow | null;
      return row ? toOrganizationRecord(row) : null;
    },

    async getOrganizationById(id) {
      const row = getOrganizationByIdStmt.get(id) as OrganizationRow | null;
      return row ? toOrganizationRecord(row) : null;
    },

    async upsertOrgMember(record) {
      upsertOrgMemberStmt.run(
        record.orgId,
        record.userId,
        record.role,
        record.userContext ?? null,
        record.createdAt,
      );
    },

    async getOrgMember(orgId, userId) {
      const row = getOrgMemberStmt.get(orgId, userId) as
        | {
            org_id: string;
            user_id: string;
            role: string;
            user_context?: string | null;
            created_at: string;
          }
        | null;

      if (!row) {
        return null;
      }

      return {
        orgId: row.org_id,
        userId: row.user_id,
        role: row.role as StoredOrgMemberRecord["role"],
        userContext: row.user_context ?? null,
        createdAt: row.created_at,
      };
    },

    async listOrgMembers(orgId) {
      return listOrgMembersStmt.all(orgId).map((row) => {
        const member = row as {
          org_id: string;
          user_id: string;
          role: string;
          user_context?: string | null;
          created_at: string;
        };

        return {
          orgId: member.org_id,
          userId: member.user_id,
          role: member.role as StoredOrgMemberRecord["role"],
          userContext: member.user_context ?? null,
          createdAt: member.created_at,
        };
      });
    },

    async listUserOrganizations(userId) {
      return listUserOrganizationsStmt.all(userId).map((row) => {
        const record = row as {
          id: string;
          name: string;
          slug: string;
          created_at: string;
          updated_at: string;
          role: string;
          joined_at: string;
        };

        return {
          organization: {
            id: record.id,
            name: record.name,
            slug: record.slug,
            createdAt: record.created_at,
            updatedAt: record.updated_at,
          },
          role: record.role as StoredUserOrganizationRecord["role"],
          joinedAt: record.joined_at,
        };
      });
    },

    async deleteOrgMember(orgId, userId) {
      const result = deleteOrgMemberStmt.run(orgId, userId);
      return result.changes > 0;
    },

    async createOrgInvite(record) {
      createOrgInviteStmt.run(
        record.id,
        record.orgId,
        record.email,
        record.role,
        record.tokenHash,
        record.invitedByUserId,
        record.expiresAt,
        record.acceptedAt,
        record.revokedAt,
        record.createdAt,
      );
    },

    async getOrgInviteByTokenHash(tokenHash) {
      const row = getOrgInviteByTokenHashStmt.get(tokenHash) as OrgInviteRow | null;
      return row ? toOrgInviteRecord(row) : null;
    },

    async getPendingOrgInvite(orgId, email) {
      const row = getPendingOrgInviteStmt.get(orgId, email.trim().toLowerCase()) as OrgInviteRow | null;
      return row ? toOrgInviteRecord(row) : null;
    },

    async markOrgInviteAccepted(id, acceptedAt) {
      markOrgInviteAcceptedStmt.run(acceptedAt, id);
    },

    async listAutomations() {
      return listAutomationsStmt.all().map((row) => toAutomationRecord(row as AutomationRow));
    },

    async listAutomationsForOrg(orgId) {
      return listAutomationsForOrgStmt
        .all(orgId)
        .map((row) => toAutomationRecord(row as AutomationRow));
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
        record.orgId ?? null,
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
        record.deliveryStatus ?? null,
        record.deliveryError ?? null,
      );
    },

    async updateAutomationRun(record) {
      updateAutomationRunStmt.run(
        record.status,
        record.completedAt,
        record.output,
        record.error,
        record.deliveryStatus ?? null,
        record.deliveryError ?? null,
        record.id,
      );
    },

    async deleteAutomationRun(automationId, runId) {
      const result = deleteAutomationRunStmt.run(automationId, runId);
      return result.changes > 0;
    },

    async getAutomationRunReadThrough(userId, orgId, automationId) {
      const row = getAutomationRunReadThroughStmt.get(userId, orgId, automationId) as
        | { read_through_at: string }
        | null
        | undefined;
      return row?.read_through_at ?? null;
    },

    async upsertAutomationRunReadThrough(userId, orgId, automationId, readThroughAt) {
      upsertAutomationRunReadThroughStmt.run(userId, orgId, automationId, readThroughAt);
    },

    async countUnreadAutomationRunsByOrg(userId, orgId) {
      return countUnreadAutomationRunsByOrgStmt.all(userId, orgId, orgId).map((row) => ({
        automationId: (row as { automation_id: string }).automation_id,
        unreadCount: Number((row as { unread_count: number }).unread_count),
      }));
    },

    async listProfiles() {
      return listProfilesStmt.all().map((row) => toProfileRecord(row as ProfileRow));
    },

    async listProfilesForOrg(orgId) {
      return listProfilesForOrgStmt
        .all(orgId)
        .map((row) => toProfileRecord(row as ProfileRow));
    },

    async getProfile(id) {
      const row = getProfileStmt.get(id) as ProfileRow | null;
      return row ? toProfileRecord(row) : null;
    },

    async getProfileForOrg(id, orgId) {
      const row = getProfileForOrgStmt.get(id, orgId) as ProfileRow | null;
      return row ? toProfileRecord(row) : null;
    },

    async getDefaultProfileForOrg(orgId) {
      const row = getDefaultProfileForOrgStmt.get(orgId) as ProfileRow | null;
      return row ? toProfileRecord(row) : null;
    },

    async upsertProfile(record) {
      if (record.isDefault && record.orgId) {
        clearDefaultProfileForOrgStmt.run(record.orgId, record.id);
      }

      upsertProfileStmt.run(
        record.id,
        record.name,
        record.systemPrompt,
        record.model,
        record.thinkingEnabled == null ? null : record.thinkingEnabled ? 1 : 0,
        record.thinkingEffort ?? null,
        record.isSuper ? 1 : 0,
        record.orgId ?? null,
        record.isDefault ? 1 : 0,
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
        record.userId ?? null,
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

    async getSessionQuestionnaire(sessionId) {
      const row = getSessionQuestionnaireStmt.get(sessionId) as {
        agent_questionnaire: string | null;
      } | null;
      return row ? parseAgentQuestionnaire(row.agent_questionnaire) : null;
    },

    async updateSessionQuestionnaire(sessionId, questionnaire) {
      updateSessionQuestionnaireStmt.run(
        questionnaire ? JSON.stringify(questionnaire) : null,
        sessionId,
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

    async insertAttachment(record) {
      insertAttachmentStmt.run(
        record.id,
        record.orgId,
        record.profileId,
        record.sessionId,
        record.channel,
        record.kind,
        record.filename,
        record.mediaType,
        record.sizeBytes,
        record.storagePath,
        record.createdAt,
      );
    },

    async getAttachment(id) {
      const row = getAttachmentStmt.get(id) as AttachmentRow | null;
      return row ? toAttachmentRecord(row) : null;
    },

    async deleteAttachment(id) {
      const result = deleteAttachmentStmt.run(id);
      return result.changes > 0;
    },

    async listTasks() {
      return listTasksStmt.all().map((row) => toTaskRecord(row as TaskRow));
    },

    async listTasksForOrg(orgId) {
      return listTasksForOrgStmt.all(orgId).map((row) => toTaskRecord(row as TaskRow));
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
        record.orgId ?? null,
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

    async listLlmUsageStatsByModel() {
      return listLlmUsageStatsByModelStmt
        .all()
        .map((row) => toLlmUsageModelStatsRecord(row as LlmUsageModelStatsRow));
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

    async incrementLlmUsageStatsByModel(modelId, delta, trackedSince) {
      const updatedAt = new Date().toISOString();
      incrementLlmUsageStatsByModelStmt.run(
        modelId,
        delta.requestCount,
        delta.inputTokens,
        delta.outputTokens,
        delta.estimatedCostUsd,
        trackedSince,
        updatedAt,
      );
    },

    async getWorkspaceSettings() {
      const row = getWorkspaceSettingsStmt.get(WORKSPACE_SETTINGS_ID) as
        | WorkspaceSettingsRow
        | null;
      return row ? toWorkspaceSettingsRecord(row) : null;
    },

    async upsertWorkspaceSettings(record) {
      upsertWorkspaceSettingsStmt.run(
        record.id,
        record.visionModel,
        record.transcriptionModel,
        JSON.stringify(record.codingAgentHarnesses),
        record.selectedCodingAgentHarness,
        record.updatedAt,
      );
    },

    async listNotificationDestinationsForOrg(orgId) {
      return listNotificationDestinationsForOrgStmt
        .all(orgId)
        .map((row) => toNotificationDestinationRecord(row as NotificationDestinationRow));
    },

    async getNotificationDestination(id) {
      const row = getNotificationDestinationStmt.get(id) as NotificationDestinationRow | null;
      return row ? toNotificationDestinationRecord(row) : null;
    },

    async upsertNotificationDestination(record) {
      upsertNotificationDestinationStmt.run(
        record.id,
        record.name,
        record.channel,
        JSON.stringify(record.config),
        record.secretHash,
        record.orgId,
        record.createdAt,
        record.updatedAt,
      );
    },

    async deleteNotificationDestination(id) {
      const result = deleteNotificationDestinationStmt.run(id);
      return result.changes > 0;
    },

    async listComposioToolkitsForOrg(orgId) {
      return listComposioToolkitsForOrgStmt
        .all(orgId)
        .map((row) => toComposioToolkitRecord(row as ComposioToolkitRow));
    },

    async getComposioToolkit(id) {
      const row = getComposioToolkitStmt.get(id) as ComposioToolkitRow | null;
      return row ? toComposioToolkitRecord(row) : null;
    },

    async getComposioToolkitBySlug(orgId, toolkitSlug) {
      const row = getComposioToolkitBySlugStmt.get(orgId, toolkitSlug) as
        | ComposioToolkitRow
        | null;
      return row ? toComposioToolkitRecord(row) : null;
    },

    async upsertComposioToolkit(record) {
      upsertComposioToolkitStmt.run(
        record.id,
        record.orgId,
        record.toolkitSlug,
        record.displayName,
        record.status,
        record.connectedAccountId,
        record.sessionIdEnc,
        record.oauthStateHash,
        JSON.stringify(record.cachedTools),
        record.lastError,
        record.createdAt,
        record.updatedAt,
      );
    },

    async deleteComposioToolkit(id) {
      const result = deleteComposioToolkitStmt.run(id);
      return result.changes > 0;
    },

    async listProfileComposioToolkits(profileId) {
      return listProfileComposioToolkitsStmt
        .all(profileId)
        .map((row) => toProfileComposioToolkitRecord(row as ProfileComposioToolkitRow));
    },

    async replaceProfileComposioToolkits(profileId, assignments) {
      deleteProfileComposioToolkitsStmt.run(profileId);

      for (const assignment of assignments) {
        insertProfileComposioToolkitStmt.run(
          assignment.profileId,
          assignment.toolkitId,
          assignment.allowedActions ? JSON.stringify(assignment.allowedActions) : null,
        );
      }
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

    async listProfilesForMcpServer(serverId) {
      return listProfilesForMcpServerStmt
        .all(serverId)
        .map((row) => toProfileRecord(row as ProfileRow));
    },

    async listMcpServerProfileCounts() {
      const counts: Record<string, number> = {};

      for (const row of listMcpServerProfileCountsStmt.all() as {
        server_id: string;
        count: number;
      }[]) {
        counts[row.server_id] = row.count;
      }

      return counts;
    },

    async listSkills() {
      return listSkillsStmt.all().map((row) => toSkillRecord(row as SkillRow));
    },

    async getSkill(id) {
      const row = getSkillStmt.get(id) as SkillRow | null;
      return row ? toSkillRecord(row) : null;
    },

    async getSkillByName(name) {
      const row = getSkillByNameStmt.get(name) as SkillRow | null;
      return row ? toSkillRecord(row) : null;
    },

    async getSkillBySourcePath(sourcePath) {
      const row = getSkillBySourcePathStmt.get(sourcePath) as SkillRow | null;
      return row ? toSkillRecord(row) : null;
    },

    async upsertSkill(record) {
      upsertSkillStmt.run(
        record.id,
        record.name,
        record.description,
        record.sourcePath,
        record.hasTool ? 1 : 0,
        record.disableModelInvocation ? 1 : 0,
        record.enabled ? 1 : 0,
        record.createdAt,
        record.updatedAt,
      );
    },

    async deleteSkill(id) {
      const result = deleteSkillStmt.run(id);
      return result.changes > 0;
    },

    async listSkillsForProfile(profileId) {
      return listSkillsForProfileStmt
        .all(profileId)
        .map((row) => toSkillRecord(row as SkillRow));
    },

    async assignSkillToProfile(profileId, skillId) {
      assignSkillStmt.run(profileId, skillId);
    },

    async unassignSkillFromProfile(profileId, skillId) {
      const result = unassignSkillStmt.run(profileId, skillId);
      return result.changes > 0;
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
    orgId: row.org_id ?? null,
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
    deliveryStatus: row.delivery_status,
    deliveryError: row.delivery_error,
  };
}

function toProfileRecord(row: ProfileRow): StoredProfileRecord {
  return {
    id: row.id,
    name: row.name,
    systemPrompt: row.system_prompt,
    model: row.model,
    thinkingEnabled:
      row.thinking_enabled == null ? null : row.thinking_enabled !== 0,
    thinkingEffort: row.thinking_effort as StoredProfileRecord["thinkingEffort"],
    isSuper: row.is_super !== 0,
    orgId: row.org_id ?? null,
    isDefault: row.is_default !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSkillRecord(row: SkillRow): StoredSkillRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sourcePath: row.source_path,
    hasTool: row.has_tool !== 0,
    disableModelInvocation: row.disable_model_invocation !== 0,
    enabled: row.enabled !== 0,
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

function parseAgentQuestionnaire(raw: string | null | undefined): AgentQuestionnaire | null {
  if (!raw || raw.trim() === "") {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const questions = record.questions;

    if (
      typeof record.id !== "string" ||
      typeof record.title !== "string" ||
      !Array.isArray(questions)
    ) {
      return null;
    }

    const validQuestions = questions.filter(
      (item): item is AgentQuestionnaire["questions"][number] =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { id?: unknown }).id === "string" &&
        typeof (item as { prompt?: unknown }).prompt === "string" &&
        typeof (item as { allowCustomAnswer?: unknown }).allowCustomAnswer === "boolean" &&
        Array.isArray((item as { choices?: unknown }).choices) &&
        ((item as { choices: unknown[] }).choices).every(
          (choice) =>
            typeof choice === "object" &&
            choice !== null &&
            typeof (choice as { id?: unknown }).id === "string" &&
            typeof (choice as { label?: unknown }).label === "string",
        ) &&
        ((item as { placeholder?: unknown }).placeholder === undefined ||
          typeof (item as { placeholder?: unknown }).placeholder === "string"),
    );

    if (validQuestions.length !== questions.length) {
      return null;
    }

    return {
      id: record.id,
      title: record.title,
      questions: validQuestions,
    };
  } catch {
    return null;
  }
}

function toSessionRecord(row: SessionRow): StoredSessionRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    channel: row.channel,
    userId: row.user_id ?? null,
    createdAt: row.created_at,
    title: row.title ?? null,
    agentTodos: parseAgentTodos(row.agent_todos),
    agentQuestionnaire: parseAgentQuestionnaire(row.agent_questionnaire),
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

function toAttachmentRecord(row: AttachmentRow): StoredAttachmentRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    profileId: row.profile_id,
    sessionId: row.session_id,
    channel: row.channel,
    kind: row.kind as StoredAttachmentRecord["kind"],
    filename: row.filename,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
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
    orgId: row.org_id ?? null,
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

function toLlmUsageModelStatsRecord(
  row: LlmUsageModelStatsRow,
): StoredLlmUsageModelStatsRecord {
  return {
    modelId: row.model_id,
    requestCount: row.request_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedCostUsd: row.estimated_cost_usd,
    trackedSince: row.tracked_since,
    updatedAt: row.updated_at,
  };
}

function toWorkspaceSettingsRecord(row: WorkspaceSettingsRow): StoredWorkspaceSettingsRecord {
  return {
    id: row.id,
    visionModel: row.vision_model?.trim() || null,
    transcriptionModel: row.transcription_model?.trim() || null,
    codingAgentHarnesses: parseCodingAgentHarnesses(row.coding_agent_harnesses),
    selectedCodingAgentHarness: row.selected_coding_agent_harness?.trim() || null,
    updatedAt: row.updated_at,
  };
}

function parseCodingAgentHarnesses(
  raw: string | null | undefined,
): StoredWorkspaceSettingsRecord["codingAgentHarnesses"] {
  if (!raw?.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (typeof item !== "object" || item === null) {
        return [];
      }

      const harness = item as Record<string, unknown>;
      const id = typeof harness.id === "string" ? harness.id.trim() : "";
      const kind = typeof harness.kind === "string" ? harness.kind.trim() : "";
      const name = typeof harness.name === "string" ? harness.name.trim() : "";
      const command = typeof harness.command === "string" ? harness.command.trim() : "";
      const args = Array.isArray(harness.args)
        ? harness.args.filter((value): value is string => typeof value === "string")
        : [];

      if (!id || !name || !command) {
        return [];
      }

      if (kind !== "codex" && kind !== "claude_code" && kind !== "opencode") {
        return [];
      }

      return [
        {
          id,
          kind,
          name,
          command,
          args,
          enabled: harness.enabled !== false,
        },
      ];
    });
  } catch {
    return [];
  }
}

function toNotificationDestinationRecord(
  row: NotificationDestinationRow,
): StoredNotificationDestinationRecord {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel,
    config: JSON.parse(row.config) as StoredNotificationDestinationRecord["config"],
    secretHash: row.secret_hash,
    orgId: row.org_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toComposioToolkitRecord(row: ComposioToolkitRow): StoredComposioToolkitRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    toolkitSlug: row.toolkit_slug,
    displayName: row.display_name,
    status: row.status as StoredComposioToolkitRecord["status"],
    connectedAccountId: row.connected_account_id,
    sessionIdEnc: row.session_id_enc,
    oauthStateHash: row.oauth_state_hash,
    cachedTools: JSON.parse(row.cached_tools) as StoredComposioToolkitRecord["cachedTools"],
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toProfileComposioToolkitRecord(
  row: ProfileComposioToolkitRow,
): StoredProfileComposioToolkitRecord {
  return {
    profileId: row.profile_id,
    toolkitId: row.toolkit_id,
    allowedActions: row.allowed_actions
      ? (JSON.parse(row.allowed_actions) as string[])
      : null,
  };
}

function toUserRecord(row: UserRow): StoredUserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name ?? null,
    phone: row.phone ?? null,
    isPlatformAdmin: Boolean(row.is_platform_admin),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOrganizationRecord(row: OrganizationRow): StoredOrganizationRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOrgInviteRecord(row: OrgInviteRow): StoredOrgInviteRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    email: row.email,
    role: row.role as StoredOrgInviteRecord["role"],
    tokenHash: row.token_hash,
    invitedByUserId: row.invited_by_user_id,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

function toBrowserSessionRecord(row: BrowserSessionRow): StoredBrowserSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sessionTokenHash: row.session_token_hash,
    csrfTokenHash: row.csrf_token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    activeOrgId: row.active_org_id ?? null,
  };
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
