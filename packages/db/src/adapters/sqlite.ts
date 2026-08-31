import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import type { AgentQuestionnaire, ChatMessage } from "@nakama/core";
import { getUserMessageText, PRIVATE_FILE_MODE } from "@nakama/core";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import { LLM_USAGE_STATS_ID, WORKSPACE_SETTINGS_ID } from "../constants";
import { ensureDatabaseDirectory, resolveDatabasePath } from "../database-url";
import { migrateDatabase } from "../migrate";
import type {
  DatabaseAdapter,
  OrgMemoryProposalStatus,
  StoredArtifactShareRecord,
  StoredAttachmentRecord,
  StoredAutomationRecord,
  StoredAutomationRunRecord,
  StoredBrowserSessionRecord,
  StoredComposioToolkitRecord,
  StoredComposioUserConnectionRecord,
  StoredLlmUsageModelStatsRecord,
  StoredLlmUsageStatsRecord,
  StoredMcpServerRecord,
  StoredNotificationDestinationRecord,
  StoredOrganizationRecord,
  StoredOrgInviteRecord,
  StoredOrgMemberRecord,
  StoredOrgMemoryProposal,
  StoredProfileComposioToolkitRecord,
  StoredProfileRecord,
  StoredSessionMessageRecord,
  StoredSessionRecord,
  StoredSessionSummaryRecord,
  StoredSkillProposal,
  StoredSkillRecord,
  StoredSkillSuggestion,
  StoredSkillUsageRecord,
  StoredTaskRecord,
  StoredTaskRunRecord,
  StoredToolRecord,
  StoredUserOrganizationRecord,
  StoredUserRecord,
  StoredWorkspaceSettingsRecord,
} from "../types";

export interface SqliteDatabase {
  adapter: DatabaseAdapter;
  close(): void;
  reopen(): Promise<void>;
}

interface AutomationRow {
  created_at: string;
  definition: string;
  enabled: number;
  id: string;
  name: string;
  org_id: string | null;
  profile_id: string;
  updated_at: string;
  version: number;
}

interface AutomationRunRow {
  automation_id: string;
  completed_at: string | null;
  delivery_error: string | null;
  delivery_status: string | null;
  error: string | null;
  id: string;
  output: string | null;
  started_at: string;
  status: string;
}

interface ProfileRow {
  created_at: string;
  id: string;
  is_default: number;
  is_super: number;
  model: string | null;
  name: string;
  org_id: string | null;
  skills_curator_consolidate_enabled: number | null;
  skills_post_turn_review: number | null;
  skills_write_approval: number | null;
  system_prompt: string;
  thinking_effort: string | null;
  thinking_enabled: number | null;
  updated_at: string;
}

interface ToolRow {
  created_at: string;
  description: string;
  handler_config: string;
  handler_type: string;
  id: string;
  name: string;
  updated_at: string;
}

interface SessionRow {
  agent_questionnaire: string | null;
  agent_todos: string;
  channel: string;
  created_at: string;
  id: string;
  model: string | null;
  profile_id: string;
  title: string | null;
  user_id?: string | null;
}

interface SessionMessageRow {
  created_at: string;
  id: string;
  payload: string;
  seq: number;
  session_id: string;
}

interface AttachmentRow {
  channel: string;
  created_at: string;
  filename: string | null;
  id: string;
  kind: string;
  media_type: string;
  org_id: string | null;
  profile_id: string;
  session_id: string | null;
  size_bytes: number;
  storage_path: string;
}

interface TaskRow {
  created_at: string;
  description: string;
  id: string;
  org_id: string | null;
  position: number;
  profile_id: string;
  prompt: string;
  session_id: string | null;
  status: string;
  title: string;
  updated_at: string;
}

interface TaskRunRow {
  completed_at: string | null;
  error: string | null;
  id: string;
  output: string | null;
  started_at: string;
  status: string;
  task_id: string;
}

interface SessionSummaryRow {
  channel: string;
  created_at: string;
  first_user_payload: string | null;
  id: string;
  message_count: number;
  profile_id: string;
  title: string | null;
  updated_at: string;
}

interface LlmUsageStatsRow {
  estimated_cost_usd: number;
  id: string;
  input_tokens: number;
  output_tokens: number;
  request_count: number;
  tracked_since: string;
  updated_at: string;
}

interface LlmUsageModelStatsRow {
  estimated_cost_usd: number;
  input_tokens: number;
  model_id: string;
  output_tokens: number;
  request_count: number;
  tracked_since: string;
  updated_at: string;
}

interface WorkspaceSettingsRow {
  automation_worker_poll_interval_ms: number;
  coding_agent_harnesses: string;
  coding_agent_provider_passthrough: number | null;
  id: string;
  image_model: string | null;
  selected_coding_agent_harness: string | null;
  token_optimizer_enabled: number | null;
  transcription_model: string | null;
  updated_at: string;
  vision_model: string | null;
}

interface NotificationDestinationRow {
  channel: "telegram";
  config: string;
  created_at: string;
  id: string;
  name: string;
  org_id: string;
  secret_hash: string;
  updated_at: string;
}

interface ComposioToolkitRow {
  cached_tools: string;
  connected_account_id: string | null;
  created_at: string;
  display_name: string;
  id: string;
  last_error: string | null;
  oauth_state_hash: string | null;
  org_id: string;
  session_id_enc: string | null;
  status: string;
  toolkit_slug: string;
  updated_at: string;
}

interface ProfileComposioToolkitRow {
  allowed_actions: string | null;
  profile_id: string;
  toolkit_id: string;
}

interface ComposioUserConnectionRow {
  connected_account_id: string | null;
  created_at: string;
  id: string;
  last_error: string | null;
  oauth_state_hash: string | null;
  org_id: string;
  session_id_enc: string | null;
  status: string;
  toolkit_id: string;
  updated_at: string;
  user_id: string;
}

interface SkillRow {
  created_at: string;
  created_by: string;
  description: string;
  disable_model_invocation: number;
  enabled: number;
  has_tool: number;
  id: string;
  name: string;
  org_id: string | null;
  source_path: string;
  updated_at: string;
}

interface SkillUsageRow {
  created_at: string;
  last_patched_at: string | null;
  last_used_at: string | null;
  last_viewed_at: string | null;
  org_id: string;
  patch_count: number;
  profile_id: string;
  skill_id: string;
  updated_at: string;
  use_count: number;
  view_count: number;
}

interface McpServerRow {
  cached_tools: string;
  config: string;
  created_at: string;
  enabled: number;
  id: string;
  last_error: string | null;
  name: string;
  status: string;
  transport: string;
  updated_at: string;
}

interface UserRow {
  created_at: string;
  email: string;
  id: string;
  is_platform_admin?: number | null;
  name?: string | null;
  password_hash: string;
  phone?: string | null;
  updated_at: string;
  user_context?: string | null;
}

interface BrowserSessionRow {
  active_org_id?: string | null;
  created_at: string;
  csrf_token_hash: string;
  expires_at: string;
  id: string;
  last_used_at: string | null;
  revoked_at: string | null;
  session_token_hash: string;
  user_id: string;
}

interface OrganizationRow {
  archived_at: string | null;
  created_at: string;
  id: string;
  name: string;
  skills_curator_archive_after_days: number;
  skills_curator_consolidate_enabled: number;
  skills_curator_enabled: number;
  skills_curator_last_run_at: string | null;
  skills_curator_stale_after_days: number;
  skills_post_turn_review: number;
  skills_write_approval: number;
  slug: string;
  updated_at: string;
}

interface OrgInviteRow {
  accepted_at: string | null;
  created_at: string;
  email: string;
  expires_at: string;
  id: string;
  invited_by_user_id: string;
  org_id: string;
  revoked_at: string | null;
  role: string;
  token_hash: string;
}

interface OrgMemoryProposalRow {
  bullet: string;
  created_at: string;
  id: string;
  org_id: string;
  pinned: number;
  profile_id: string | null;
  proposed_by_user_id: string | null;
  reviewed_at: string | null;
  reviewer_user_id: string | null;
  session_id: string | null;
  status: string;
}

interface SkillProposalRow {
  action: string;
  consolidate_loser_skill_names: string | null;
  content: string | null;
  created_at: string;
  id: string;
  org_id: string;
  patch_new_string: string | null;
  patch_old_string: string | null;
  profile_id: string;
  proposed_by_user_id: string | null;
  relative_path: string | null;
  reviewed_at: string | null;
  reviewer_user_id: string | null;
  session_id: string | null;
  skill_name: string;
  status: string;
}

interface SkillSuggestionRow {
  action: string;
  applied_at: string | null;
  content: string | null;
  created_at: string;
  id: string;
  org_id: string;
  patch_new_string: string | null;
  patch_old_string: string | null;
  profile_id: string;
  proposed_by_user_id: string | null;
  session_id: string | null;
  skill_name: string;
  source: string;
  status: string;
  warnings: string | null;
}

interface ArtifactShareRow {
  created_at: string;
  created_by_user_id: string;
  filename: string;
  id: string;
  mime_type: string;
  org_id: string;
  profile_id: string;
  revoked_at: string | null;
  size_bytes: number;
  source_path: string;
  storage_path: string;
  token_hash: string;
}

/**
 * The file holds plaintext MCP credentials and every transcript, so it carries
 * the same 0600 the rest of ~/.nakama already uses. bun:sqlite takes no mode, and
 * an existing loose file keeps its own, so chmod after open rather than at create.
 */
export function openPrivateDatabase(databasePath: string): Database {
  ensureDatabaseDirectory(databasePath);
  const db = new Database(databasePath, { create: true });

  if (databasePath !== ":memory:") {
    chmodSync(databasePath, PRIVATE_FILE_MODE);
  }

  return db;
}

export async function createSqliteDatabase(
  databaseUrl: string
): Promise<SqliteDatabase> {
  const databasePath = resolveDatabasePath(databaseUrl);

  let db = openPrivateDatabase(databasePath);
  migrateDatabase(db);
  let adapter = createSqliteDatabaseAdapter(db);

  // Stable proxy so services keep one adapter reference across reopen().
  const adapterProxy = new Proxy({} as DatabaseAdapter, {
    get(_target, property, receiver) {
      const value = Reflect.get(adapter as object, property, receiver);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(adapter)
        : value;
    },
  });

  return {
    adapter: adapterProxy,
    close() {
      db.close();
    },
    async reopen() {
      const nextDb = openPrivateDatabase(databasePath);
      migrateDatabase(nextDb);
      const nextAdapter = createSqliteDatabaseAdapter(nextDb);
      const previousDb = db;
      db = nextDb;
      adapter = nextAdapter;
      previousDb.close();
    },
  };
}

function createSqliteDatabaseAdapter(db: Database): DatabaseAdapter {
  const listAutomationsStmt = db.prepare("SELECT * FROM automations");
  const listAutomationsForOrgStmt = db.prepare(
    "SELECT * FROM automations WHERE org_id = ? ORDER BY updated_at DESC"
  );
  const getAutomationStmt = db.prepare(
    "SELECT * FROM automations WHERE id = ?"
  );
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
  const deleteAutomationStmt = db.prepare(
    "DELETE FROM automations WHERE id = ?"
  );

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
    "SELECT * FROM profiles WHERE org_id = ? ORDER BY is_default DESC, name ASC"
  );
  const getProfileStmt = db.prepare("SELECT * FROM profiles WHERE id = ?");
  const getProfileForOrgStmt = db.prepare(
    "SELECT * FROM profiles WHERE id = ? AND org_id = ?"
  );
  const getDefaultProfileForOrgStmt = db.prepare(
    "SELECT * FROM profiles WHERE org_id = ? AND is_default = 1 LIMIT 1"
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
      skills_write_approval,
      skills_post_turn_review,
      skills_curator_consolidate_enabled,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      system_prompt = excluded.system_prompt,
      model = excluded.model,
      thinking_enabled = excluded.thinking_enabled,
      thinking_effort = excluded.thinking_effort,
      is_super = excluded.is_super,
      org_id = excluded.org_id,
      is_default = excluded.is_default,
      skills_write_approval = excluded.skills_write_approval,
      skills_post_turn_review = excluded.skills_post_turn_review,
      skills_curator_consolidate_enabled = excluded.skills_curator_consolidate_enabled,
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
    INSERT INTO sessions (id, profile_id, channel, created_at, user_id, model)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      profile_id = excluded.profile_id,
      channel = excluded.channel,
      user_id = COALESCE(excluded.user_id, sessions.user_id),
      model = excluded.model
  `);
  const deleteSessionStmt = db.prepare("DELETE FROM sessions WHERE id = ?");
  const updateSessionModelStmt = db.prepare(
    "UPDATE sessions SET model = ? WHERE id = ?"
  );
  const updateSessionTitleStmt = db.prepare(`
    UPDATE sessions SET title = ? WHERE id = ? AND title IS NULL
  `);
  const getSessionTodosStmt = db.prepare(
    "SELECT agent_todos FROM sessions WHERE id = ?"
  );
  const updateSessionTodosStmt = db.prepare(
    "UPDATE sessions SET agent_todos = ? WHERE id = ?"
  );
  const getSessionQuestionnaireStmt = db.prepare(
    "SELECT agent_questionnaire FROM sessions WHERE id = ?"
  );
  const updateSessionQuestionnaireStmt = db.prepare(
    "UPDATE sessions SET agent_questionnaire = ? WHERE id = ?"
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
    "DELETE FROM session_messages WHERE session_id = ?"
  );
  const insertAttachmentStmt = db.prepare(`
    INSERT INTO attachments (
      id, org_id, profile_id, session_id, channel, kind, filename,
      media_type, size_bytes, storage_path, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getAttachmentStmt = db.prepare(
    "SELECT * FROM attachments WHERE id = ?"
  );
  const deleteAttachmentStmt = db.prepare(
    "DELETE FROM attachments WHERE id = ?"
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

  const listTasksStmt = db.prepare(
    "SELECT * FROM tasks ORDER BY status ASC, position ASC"
  );
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
    "SELECT * FROM llm_usage_stats WHERE id = ?"
  );
  const listLlmUsageStatsByModelStmt = db.prepare(`
    SELECT * FROM llm_usage_model_stats
    ORDER BY request_count DESC, input_tokens + output_tokens DESC, model_id ASC
  `);
  const listMcpServersStmt = db.prepare("SELECT * FROM mcp_servers");
  const getMcpServerStmt = db.prepare("SELECT * FROM mcp_servers WHERE id = ?");
  const getMcpServerByNameStmt = db.prepare(
    "SELECT * FROM mcp_servers WHERE name = ?"
  );
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
  const deleteMcpServerStmt = db.prepare(
    "DELETE FROM mcp_servers WHERE id = ?"
  );
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
  // The org's own skill wins over a global skill of the same name.
  const getSkillByNameStmt = db.prepare(`
    SELECT * FROM skills
    WHERE name = ? AND (org_id IS NULL OR org_id = ?)
    ORDER BY org_id IS NULL
    LIMIT 1
  `);
  const getSkillBySourcePathStmt = db.prepare(
    "SELECT * FROM skills WHERE source_path = ?"
  );
  const upsertSkillStmt = db.prepare(`
    INSERT INTO skills (
      id, name, description, source_path, has_tool, disable_model_invocation, enabled, created_by, org_id, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      source_path = excluded.source_path,
      has_tool = excluded.has_tool,
      disable_model_invocation = excluded.disable_model_invocation,
      enabled = excluded.enabled,
      created_by = excluded.created_by,
      org_id = excluded.org_id,
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
  const listSkillUsageForProfileStmt = db.prepare(`
    SELECT * FROM profile_skill_usage WHERE profile_id = ?
  `);
  const getSkillUsageStmt = db.prepare(`
    SELECT * FROM profile_skill_usage WHERE profile_id = ? AND skill_id = ?
  `);
  const incrementSkillUsageStmt = db.prepare(`
    INSERT INTO profile_skill_usage (
      org_id,
      profile_id,
      skill_id,
      view_count,
      use_count,
      patch_count,
      last_viewed_at,
      last_used_at,
      last_patched_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, skill_id) DO UPDATE SET
      view_count = profile_skill_usage.view_count + excluded.view_count,
      use_count = profile_skill_usage.use_count + excluded.use_count,
      patch_count = profile_skill_usage.patch_count + excluded.patch_count,
      last_viewed_at = COALESCE(excluded.last_viewed_at, profile_skill_usage.last_viewed_at),
      last_used_at = COALESCE(excluded.last_used_at, profile_skill_usage.last_used_at),
      last_patched_at = COALESCE(excluded.last_patched_at, profile_skill_usage.last_patched_at),
      updated_at = excluded.updated_at
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
  const incrementToolOutputSavingsStmt = db.prepare(`
    INSERT INTO tool_output_savings (
      org_id, bucket, optimizer, tool, calls, bytes_in, bytes_out, tracked_since, updated_at
    )
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(org_id, bucket, optimizer, tool) DO UPDATE SET
      calls = tool_output_savings.calls + 1,
      bytes_in = tool_output_savings.bytes_in + excluded.bytes_in,
      bytes_out = tool_output_savings.bytes_out + excluded.bytes_out,
      updated_at = excluded.updated_at
  `);
  const listToolOutputSavingsStmt = db.prepare(
    "SELECT * FROM tool_output_savings WHERE org_id = ? ORDER BY bucket ASC, (bytes_in - bytes_out) DESC"
  );
  const incrementLlmTurnUsageStmt = db.prepare(`
    INSERT INTO llm_turn_usage (
      org_id, bucket, arm, turns, input_tokens, output_tokens, estimated_turns, updated_at
    )
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(org_id, bucket, arm) DO UPDATE SET
      turns = llm_turn_usage.turns + 1,
      input_tokens = llm_turn_usage.input_tokens + excluded.input_tokens,
      output_tokens = llm_turn_usage.output_tokens + excluded.output_tokens,
      estimated_turns = llm_turn_usage.estimated_turns + excluded.estimated_turns,
      updated_at = excluded.updated_at
  `);
  const listLlmTurnUsageStmt = db.prepare(
    "SELECT * FROM llm_turn_usage WHERE org_id = ? ORDER BY bucket ASC"
  );
  const getWorkspaceSettingsStmt = db.prepare(
    "SELECT * FROM workspace_settings WHERE id = ?"
  );
  const upsertWorkspaceSettingsStmt = db.prepare(`
    INSERT INTO workspace_settings (
      id,
      vision_model,
      transcription_model,
      image_model,
      coding_agent_harnesses,
      selected_coding_agent_harness,
      token_optimizer_enabled,
      coding_agent_provider_passthrough,
      automation_worker_poll_interval_ms,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      vision_model = excluded.vision_model,
      transcription_model = excluded.transcription_model,
      image_model = excluded.image_model,
      coding_agent_harnesses = excluded.coding_agent_harnesses,
      selected_coding_agent_harness = excluded.selected_coding_agent_harness,
      token_optimizer_enabled = excluded.token_optimizer_enabled,
      coding_agent_provider_passthrough = excluded.coding_agent_provider_passthrough,
      automation_worker_poll_interval_ms = excluded.automation_worker_poll_interval_ms,
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
  const listComposioUserConnectionsForUserStmt = db.prepare(`
    SELECT
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
    FROM composio_user_connections
    WHERE org_id = ? AND user_id = ?
    ORDER BY updated_at DESC
  `);
  const getComposioUserConnectionStmt = db.prepare(`
    SELECT
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
    FROM composio_user_connections
    WHERE user_id = ? AND toolkit_id = ?
  `);
  const getComposioUserConnectionByIdStmt = db.prepare(`
    SELECT
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
    FROM composio_user_connections
    WHERE id = ?
  `);
  const upsertComposioUserConnectionStmt = db.prepare(`
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
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      org_id = excluded.org_id,
      user_id = excluded.user_id,
      toolkit_id = excluded.toolkit_id,
      status = excluded.status,
      connected_account_id = excluded.connected_account_id,
      session_id_enc = excluded.session_id_enc,
      oauth_state_hash = excluded.oauth_state_hash,
      last_error = excluded.last_error,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);
  const deleteComposioUserConnectionStmt = db.prepare(`
    DELETE FROM composio_user_connections WHERE id = ?
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
    SET name = ?, phone = ?, email = COALESCE(?, email), updated_at = ?
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
    "SELECT COUNT(*) as count FROM users WHERE id != ?"
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
  const revokeBrowserSessionsForUserStmt = db.prepare(`
    UPDATE browser_sessions
    SET revoked_at = ?
    WHERE user_id = ? AND revoked_at IS NULL
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
  const tryMarkOrganizationArchivedStmt = db.prepare(`
    UPDATE organizations
    SET archived_at = ?, updated_at = ?
    WHERE id = ?
      AND archived_at IS NULL
      AND (SELECT COUNT(*) FROM organizations WHERE archived_at IS NULL) > 1
  `);
  const upsertOrganizationStmt = db.prepare(`
    INSERT INTO organizations (id, name, slug, skills_write_approval, skills_post_turn_review, skills_curator_enabled, skills_curator_stale_after_days, skills_curator_archive_after_days, skills_curator_consolidate_enabled, skills_curator_last_run_at, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      slug = excluded.slug,
      skills_write_approval = excluded.skills_write_approval,
      skills_post_turn_review = excluded.skills_post_turn_review,
      skills_curator_enabled = excluded.skills_curator_enabled,
      skills_curator_stale_after_days = excluded.skills_curator_stale_after_days,
      skills_curator_archive_after_days = excluded.skills_curator_archive_after_days,
      skills_curator_consolidate_enabled = excluded.skills_curator_consolidate_enabled,
      skills_curator_last_run_at = excluded.skills_curator_last_run_at,
      archived_at = excluded.archived_at,
      updated_at = excluded.updated_at
  `);
  const listOrganizationsStmt = db.prepare(`
    SELECT id, name, slug, skills_write_approval, skills_post_turn_review, skills_curator_enabled, skills_curator_consolidate_enabled, skills_curator_last_run_at, archived_at, created_at, updated_at
    FROM organizations
    ORDER BY name ASC
  `);
  const getOrganizationBySlugStmt = db.prepare(`
    SELECT id, name, slug, skills_write_approval, skills_post_turn_review, skills_curator_enabled, skills_curator_consolidate_enabled, skills_curator_last_run_at, archived_at, created_at, updated_at
    FROM organizations
    WHERE slug = ?
    LIMIT 1
  `);
  const getOrganizationByIdStmt = db.prepare(`
    SELECT id, name, slug, skills_write_approval, skills_post_turn_review, skills_curator_enabled, skills_curator_consolidate_enabled, skills_curator_last_run_at, archived_at, created_at, updated_at
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
  const createOrgMemoryProposalStmt = db.prepare(`
    INSERT INTO org_memory_proposals (
      id, org_id, profile_id, session_id, proposed_by_user_id,
      bullet, status, pinned, reviewer_user_id, reviewed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const listOrgMemoryProposalsStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, session_id, proposed_by_user_id,
      bullet, status, pinned, reviewer_user_id, reviewed_at, created_at
    FROM org_memory_proposals
    WHERE org_id = ? AND status = ?
    ORDER BY created_at DESC
  `);
  const listAllOrgMemoryProposalsStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, session_id, proposed_by_user_id,
      bullet, status, pinned, reviewer_user_id, reviewed_at, created_at
    FROM org_memory_proposals
    WHERE org_id = ?
    ORDER BY created_at DESC
  `);
  const getOrgMemoryProposalStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, session_id, proposed_by_user_id,
      bullet, status, pinned, reviewer_user_id, reviewed_at, created_at
    FROM org_memory_proposals
    WHERE org_id = ? AND id = ?
    LIMIT 1
  `);
  const getPendingOrgMemoryProposalByBulletStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, session_id, proposed_by_user_id,
      bullet, status, pinned, reviewer_user_id, reviewed_at, created_at
    FROM org_memory_proposals
    WHERE org_id = ? AND bullet = ? AND status = 'pending'
    LIMIT 1
  `);
  const updateOrgMemoryProposalStatusStmt = db.prepare(`
    UPDATE org_memory_proposals
    SET status = ?, reviewer_user_id = ?, reviewed_at = ?, pinned = ?
    WHERE org_id = ? AND id = ?
  `);
  const countOrgMemoryProposalsStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM org_memory_proposals
    WHERE org_id = ? AND status = ?
  `);
  const createSkillProposalStmt = db.prepare(`
    INSERT INTO skill_proposals (
      id, org_id, profile_id, session_id, proposed_by_user_id,
      action, skill_name, content, patch_old_string, patch_new_string, relative_path,
      consolidate_loser_skill_names,
      status, reviewer_user_id, reviewed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const listSkillProposalsByStatusStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, session_id, proposed_by_user_id,
      action, skill_name, content, patch_old_string, patch_new_string, relative_path,
      consolidate_loser_skill_names,
      status, reviewer_user_id, reviewed_at, created_at
    FROM skill_proposals
    WHERE org_id = ? AND status = ?
    ORDER BY created_at DESC
  `);
  const listSkillProposalsByStatusAndProfileStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, session_id, proposed_by_user_id,
      action, skill_name, content, patch_old_string, patch_new_string, relative_path,
      consolidate_loser_skill_names,
      status, reviewer_user_id, reviewed_at, created_at
    FROM skill_proposals
    WHERE org_id = ? AND status = ? AND profile_id = ?
    ORDER BY created_at DESC
  `);
  const listAllSkillProposalsStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, session_id, proposed_by_user_id,
      action, skill_name, content, patch_old_string, patch_new_string, relative_path,
      consolidate_loser_skill_names,
      status, reviewer_user_id, reviewed_at, created_at
    FROM skill_proposals
    WHERE org_id = ?
    ORDER BY created_at DESC
  `);
  const listAllSkillProposalsForProfileStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, session_id, proposed_by_user_id,
      action, skill_name, content, patch_old_string, patch_new_string, relative_path,
      consolidate_loser_skill_names,
      status, reviewer_user_id, reviewed_at, created_at
    FROM skill_proposals
    WHERE org_id = ? AND profile_id = ?
    ORDER BY created_at DESC
  `);
  const getSkillProposalStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, session_id, proposed_by_user_id,
      action, skill_name, content, patch_old_string, patch_new_string, relative_path,
      consolidate_loser_skill_names,
      status, reviewer_user_id, reviewed_at, created_at
    FROM skill_proposals
    WHERE org_id = ? AND id = ?
    LIMIT 1
  `);
  const getPendingSkillProposalForCreateStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, session_id, proposed_by_user_id,
      action, skill_name, content, patch_old_string, patch_new_string, relative_path,
      consolidate_loser_skill_names,
      status, reviewer_user_id, reviewed_at, created_at
    FROM skill_proposals
    WHERE org_id = ? AND profile_id = ? AND skill_name = ? AND action = 'create' AND status = 'pending'
    LIMIT 1
  `);
  const getPendingSkillProposalForSkillStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, session_id, proposed_by_user_id,
      action, skill_name, content, patch_old_string, patch_new_string, relative_path,
      consolidate_loser_skill_names,
      status, reviewer_user_id, reviewed_at, created_at
    FROM skill_proposals
    WHERE org_id = ? AND profile_id = ? AND skill_name = ? AND status = 'pending'
    LIMIT 1
  `);
  const getPendingSkillProposalForPatchStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, session_id, proposed_by_user_id,
      action, skill_name, content, patch_old_string, patch_new_string, relative_path,
      consolidate_loser_skill_names,
      status, reviewer_user_id, reviewed_at, created_at
    FROM skill_proposals
    WHERE org_id = ? AND profile_id = ? AND skill_name = ? AND action = 'patch'
      AND patch_old_string = ? AND patch_new_string = ? AND status = 'pending'
    LIMIT 1
  `);
  const updateSkillProposalStatusStmt = db.prepare(`
    UPDATE skill_proposals
    SET status = ?, reviewer_user_id = ?, reviewed_at = ?
    WHERE org_id = ? AND id = ?
  `);
  const countPendingSkillProposalsStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM skill_proposals
    WHERE org_id = ? AND status = 'pending'
  `);
  const countPendingSkillProposalsForProfileStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM skill_proposals
    WHERE org_id = ? AND profile_id = ? AND status = 'pending'
  `);
  const createSkillSuggestionStmt = db.prepare(`
    INSERT INTO skill_suggestions (
      id, org_id, profile_id, session_id, proposed_by_user_id,
      action, skill_name, content, patch_old_string, patch_new_string,
      status, source, warnings, created_at, applied_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getSkillSuggestionStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, session_id, proposed_by_user_id,
      action, skill_name, content, patch_old_string, patch_new_string,
      status, source, warnings, created_at, applied_at
    FROM skill_suggestions
    WHERE org_id = ? AND id = ?
    LIMIT 1
  `);
  const markSkillSuggestionAppliedStmt = db.prepare(`
    UPDATE skill_suggestions
    SET status = 'applied', applied_at = ?
    WHERE org_id = ? AND id = ?
  `);
  const createArtifactShareStmt = db.prepare(`
    INSERT INTO artifact_shares (
      id, org_id, profile_id, source_path, filename, mime_type, size_bytes,
      token_hash, storage_path, created_by_user_id, created_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateArtifactShareSnapshotStmt = db.prepare(`
    UPDATE artifact_shares
    SET filename = ?, mime_type = ?, size_bytes = ?, storage_path = ?
    WHERE id = ?
  `);
  const getArtifactShareByTokenHashStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, source_path, filename, mime_type, size_bytes,
      token_hash, storage_path, created_by_user_id, created_at, revoked_at
    FROM artifact_shares
    WHERE token_hash = ? AND revoked_at IS NULL
    LIMIT 1
  `);
  const getActiveArtifactShareByPathStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, source_path, filename, mime_type, size_bytes,
      token_hash, storage_path, created_by_user_id, created_at, revoked_at
    FROM artifact_shares
    WHERE org_id = ? AND profile_id = ? AND source_path = ? AND revoked_at IS NULL
    LIMIT 1
  `);
  const getArtifactShareByIdStmt = db.prepare(`
    SELECT
      id, org_id, profile_id, source_path, filename, mime_type, size_bytes,
      token_hash, storage_path, created_by_user_id, created_at, revoked_at
    FROM artifact_shares
    WHERE org_id = ? AND profile_id = ? AND id = ?
    LIMIT 1
  `);
  const revokeArtifactShareStmt = db.prepare(`
    UPDATE artifact_shares
    SET revoked_at = ?
    WHERE id = ? AND revoked_at IS NULL
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
      o.skills_write_approval,
      o.skills_post_turn_review,
      o.skills_curator_enabled,
      o.skills_curator_consolidate_enabled,
      o.skills_curator_last_run_at,
      o.archived_at,
      o.created_at,
      o.updated_at,
      om.role,
      om.created_at AS joined_at
    FROM org_members om
    INNER JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = ?
      AND o.archived_at IS NULL
    ORDER BY o.name ASC
  `);
  const deleteOrgMemberStmt = db.prepare(`
    DELETE FROM org_members
    WHERE org_id = ? AND user_id = ?
  `);

  return {
    async appendMessagesForSession(sessionId, messages) {
      for (const message of messages) {
        appendMessageStmt.run(
          message.id,
          sessionId,
          message.seq,
          JSON.stringify(message.payload),
          message.createdAt
        );
      }
    },

    async assignMcpServerToProfile(profileId, serverId) {
      assignMcpServerStmt.run(profileId, serverId);
    },

    async assignSkillToProfile(profileId, skillId) {
      assignSkillStmt.run(profileId, skillId);
    },

    async assignToolToProfile(profileId, toolId) {
      assignToolStmt.run(profileId, toolId);
    },

    async countHumanUsers() {
      const row = countHumanUsersStmt.get(LOCAL_CLIENT_USER_ID) as {
        count: number;
      };
      return row.count;
    },

    async countOrgMemoryProposals(orgId, status) {
      const row = countOrgMemoryProposalsStmt.get(orgId, status) as {
        count: number;
      };
      return row.count;
    },

    async countPendingSkillProposals(orgId, profileId) {
      const row = (
        profileId
          ? countPendingSkillProposalsForProfileStmt.get(orgId, profileId)
          : countPendingSkillProposalsStmt.get(orgId)
      ) as { count: number };
      return row.count;
    },

    async countProfileMcpAssignments() {
      const row = countProfileMcpAssignmentsStmt.get() as { count: number };
      return row.count;
    },

    async countUnreadAutomationRunsByOrg(userId, orgId) {
      return countUnreadAutomationRunsByOrgStmt
        .all(userId, orgId, orgId)
        .map((row) => ({
          automationId: (row as { automation_id: string }).automation_id,
          unreadCount: Number((row as { unread_count: number }).unread_count),
        }));
    },

    async countUsers() {
      const row = countUsersStmt.get() as { count: number };
      return row.count;
    },

    async createArtifactShare(record) {
      createArtifactShareStmt.run(
        record.id,
        record.orgId,
        record.profileId,
        record.sourcePath,
        record.filename,
        record.mimeType,
        record.sizeBytes,
        record.tokenHash,
        record.storagePath,
        record.createdByUserId,
        record.createdAt,
        record.revokedAt
      );
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
        record.activeOrgId ?? null
      );
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
        record.createdAt
      );
    },

    async createOrgMemoryProposal(record) {
      createOrgMemoryProposalStmt.run(
        record.id,
        record.orgId,
        record.profileId,
        record.sessionId,
        record.proposedByUserId,
        record.bullet,
        record.status,
        record.pinned ? 1 : 0,
        record.reviewerUserId,
        record.reviewedAt,
        record.createdAt
      );
    },

    async createSkillProposal(record) {
      createSkillProposalStmt.run(
        record.id,
        record.orgId,
        record.profileId,
        record.sessionId,
        record.proposedByUserId,
        record.action,
        record.skillName,
        record.content,
        record.patchOldString,
        record.patchNewString,
        record.relativePath,
        record.consolidateLoserSkillNames
          ? JSON.stringify(record.consolidateLoserSkillNames)
          : null,
        record.status,
        record.reviewerUserId,
        record.reviewedAt,
        record.createdAt
      );
    },

    async createSkillSuggestion(record) {
      createSkillSuggestionStmt.run(
        record.id,
        record.orgId,
        record.profileId,
        record.sessionId,
        record.proposedByUserId,
        record.action,
        record.skillName,
        record.content,
        record.patchOldString,
        record.patchNewString,
        record.status,
        record.source,
        record.warnings ? JSON.stringify(record.warnings) : null,
        record.createdAt,
        record.appliedAt
      );
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
        record.updatedAt
      );
    },

    async deleteAttachment(id) {
      const result = deleteAttachmentStmt.run(id);
      return result.changes > 0;
    },

    async deleteAutomation(id) {
      const result = deleteAutomationStmt.run(id);
      return result.changes > 0;
    },

    async deleteAutomationRun(automationId, runId) {
      const result = deleteAutomationRunStmt.run(automationId, runId);
      return result.changes > 0;
    },

    async deleteComposioToolkit(id) {
      const result = deleteComposioToolkitStmt.run(id);
      return result.changes > 0;
    },

    async deleteComposioUserConnection(id) {
      const result = deleteComposioUserConnectionStmt.run(id);
      return result.changes > 0;
    },

    async deleteMcpServer(id) {
      const result = deleteMcpServerStmt.run(id);
      return result.changes > 0;
    },

    async deleteMessagesForSession(sessionId) {
      deleteMessagesForSessionStmt.run(sessionId);
    },

    async deleteNotificationDestination(id) {
      const result = deleteNotificationDestinationStmt.run(id);
      return result.changes > 0;
    },

    async deleteOrgMember(orgId, userId) {
      const result = deleteOrgMemberStmt.run(orgId, userId);
      return result.changes > 0;
    },

    async deleteProfile(id) {
      const result = deleteProfileStmt.run(id);
      return result.changes > 0;
    },

    async deleteSession(id) {
      const result = deleteSessionStmt.run(id);
      return result.changes > 0;
    },

    async deleteSkill(id) {
      const result = deleteSkillStmt.run(id);
      return result.changes > 0;
    },

    async deleteTask(id) {
      const result = deleteTaskStmt.run(id);
      return result.changes > 0;
    },

    async deleteTool(id) {
      const result = deleteToolStmt.run(id);
      return result.changes > 0;
    },

    async getActiveArtifactShareByPath(orgId, profileId, sourcePath) {
      const row = getActiveArtifactShareByPathStmt.get(
        orgId,
        profileId,
        sourcePath
      ) as ArtifactShareRow | null;
      return row ? toArtifactShareRecord(row) : null;
    },

    async getActiveAutomationRun(automationId) {
      const row = getActiveAutomationRunStmt.get(
        automationId
      ) as AutomationRunRow | null;
      return row ? toAutomationRunRecord(row) : null;
    },

    async getActiveTaskRun(taskId) {
      const row = getActiveTaskRunStmt.get(taskId) as TaskRunRow | null;
      return row ? toTaskRunRecord(row) : null;
    },

    async getArtifactShareById(orgId, profileId, shareId) {
      const row = getArtifactShareByIdStmt.get(
        orgId,
        profileId,
        shareId
      ) as ArtifactShareRow | null;
      return row ? toArtifactShareRecord(row) : null;
    },

    async getArtifactShareByTokenHash(tokenHash) {
      const row = getArtifactShareByTokenHashStmt.get(
        tokenHash
      ) as ArtifactShareRow | null;
      return row ? toArtifactShareRecord(row) : null;
    },

    async getAttachment(id) {
      const row = getAttachmentStmt.get(id) as AttachmentRow | null;
      return row ? toAttachmentRecord(row) : null;
    },

    async getAutomation(id) {
      const row = getAutomationStmt.get(id) as AutomationRow | null;
      return row ? toAutomationRecord(row) : null;
    },

    async getAutomationRunReadThrough(userId, orgId, automationId) {
      const row = getAutomationRunReadThroughStmt.get(
        userId,
        orgId,
        automationId
      ) as { read_through_at: string } | null | undefined;
      return row?.read_through_at ?? null;
    },

    async getBrowserSessionBySessionTokenHash(sessionTokenHash) {
      const row = getBrowserSessionByTokenHashStmt.get(
        sessionTokenHash
      ) as BrowserSessionRow | null;
      return row ? toBrowserSessionRecord(row) : null;
    },

    async getComposioToolkit(id) {
      const row = getComposioToolkitStmt.get(id) as ComposioToolkitRow | null;
      return row ? toComposioToolkitRecord(row) : null;
    },

    async getComposioToolkitBySlug(orgId, toolkitSlug) {
      const row = getComposioToolkitBySlugStmt.get(
        orgId,
        toolkitSlug
      ) as ComposioToolkitRow | null;
      return row ? toComposioToolkitRecord(row) : null;
    },

    async getComposioUserConnection(userId, toolkitId) {
      const row = getComposioUserConnectionStmt.get(
        userId,
        toolkitId
      ) as ComposioUserConnectionRow | null;
      return row ? toComposioUserConnectionRecord(row) : null;
    },

    async getComposioUserConnectionById(id) {
      const row = getComposioUserConnectionByIdStmt.get(
        id
      ) as ComposioUserConnectionRow | null;
      return row ? toComposioUserConnectionRecord(row) : null;
    },

    async getDefaultProfileForOrg(orgId) {
      const row = getDefaultProfileForOrgStmt.get(orgId) as ProfileRow | null;
      return row ? toProfileRecord(row) : null;
    },

    async getLlmUsageStats() {
      const row = getLlmUsageStatsStmt.get(
        LLM_USAGE_STATS_ID
      ) as LlmUsageStatsRow | null;
      return row ? toLlmUsageStatsRecord(row) : null;
    },

    async getMcpServer(id) {
      const row = getMcpServerStmt.get(id) as McpServerRow | null;
      return row ? toMcpServerRecord(row) : null;
    },

    async getMcpServerByName(name) {
      const row = getMcpServerByNameStmt.get(name) as McpServerRow | null;
      return row ? toMcpServerRecord(row) : null;
    },

    async getNotificationDestination(id) {
      const row = getNotificationDestinationStmt.get(
        id
      ) as NotificationDestinationRow | null;
      return row ? toNotificationDestinationRecord(row) : null;
    },

    async getOrganizationById(id) {
      const row = getOrganizationByIdStmt.get(id) as OrganizationRow | null;
      return row ? toOrganizationRecord(row) : null;
    },

    async getOrganizationBySlug(slug) {
      const row = getOrganizationBySlugStmt.get(slug) as OrganizationRow | null;
      return row ? toOrganizationRecord(row) : null;
    },

    async getOrgInviteByTokenHash(tokenHash) {
      const row = getOrgInviteByTokenHashStmt.get(
        tokenHash
      ) as OrgInviteRow | null;
      return row ? toOrgInviteRecord(row) : null;
    },

    async getOrgMember(orgId, userId) {
      const row = getOrgMemberStmt.get(orgId, userId) as {
        org_id: string;
        user_id: string;
        role: string;
        user_context?: string | null;
        created_at: string;
      } | null;

      if (!row) {
        return null;
      }

      return {
        createdAt: row.created_at,
        orgId: row.org_id,
        role: row.role as StoredOrgMemberRecord["role"],
        userContext: row.user_context ?? null,
        userId: row.user_id,
      };
    },

    async getOrgMemoryProposal(orgId, id) {
      const row = getOrgMemoryProposalStmt.get(
        orgId,
        id
      ) as OrgMemoryProposalRow | null;
      return row ? toOrgMemoryProposalRecord(row) : null;
    },

    async getPendingOrgInvite(orgId, email) {
      const row = getPendingOrgInviteStmt.get(
        orgId,
        email.trim().toLowerCase()
      ) as OrgInviteRow | null;
      return row ? toOrgInviteRecord(row) : null;
    },

    async getPendingOrgMemoryProposalByBullet(orgId, bullet) {
      const row = getPendingOrgMemoryProposalByBulletStmt.get(
        orgId,
        bullet
      ) as OrgMemoryProposalRow | null;
      return row ? toOrgMemoryProposalRecord(row) : null;
    },

    async getPendingSkillProposalForCreate(orgId, profileId, skillName) {
      const row = getPendingSkillProposalForCreateStmt.get(
        orgId,
        profileId,
        skillName
      ) as SkillProposalRow | null;
      return row ? toSkillProposalRecord(row) : null;
    },

    async getPendingSkillProposalForPatch(
      orgId,
      profileId,
      skillName,
      patchOldString,
      patchNewString
    ) {
      const row = getPendingSkillProposalForPatchStmt.get(
        orgId,
        profileId,
        skillName,
        patchOldString,
        patchNewString
      ) as SkillProposalRow | null;
      return row ? toSkillProposalRecord(row) : null;
    },

    async getPendingSkillProposalForSkill(orgId, profileId, skillName) {
      const row = getPendingSkillProposalForSkillStmt.get(
        orgId,
        profileId,
        skillName
      ) as SkillProposalRow | null;
      return row ? toSkillProposalRecord(row) : null;
    },

    async getProfile(id) {
      const row = getProfileStmt.get(id) as ProfileRow | null;
      return row ? toProfileRecord(row) : null;
    },

    async getProfileForOrg(id, orgId) {
      const row = getProfileForOrgStmt.get(id, orgId) as ProfileRow | null;
      return row ? toProfileRecord(row) : null;
    },

    async getSession(id) {
      const row = getSessionStmt.get(id) as SessionRow | null;
      return row ? toSessionRecord(row) : null;
    },

    async getSessionQuestionnaire(sessionId) {
      const row = getSessionQuestionnaireStmt.get(sessionId) as {
        agent_questionnaire: string | null;
      } | null;
      return row ? parseAgentQuestionnaire(row.agent_questionnaire) : null;
    },

    async getSessionTodos(sessionId) {
      const row = getSessionTodosStmt.get(sessionId) as {
        agent_todos: string;
      } | null;
      return row ? parseAgentTodos(row.agent_todos) : [];
    },

    async getSkill(id) {
      const row = getSkillStmt.get(id) as SkillRow | null;
      return row ? toSkillRecord(row) : null;
    },

    async getSkillByName(name, orgId) {
      const row = getSkillByNameStmt.get(
        name,
        orgId ?? null
      ) as SkillRow | null;
      return row ? toSkillRecord(row) : null;
    },

    async getSkillBySourcePath(sourcePath) {
      const row = getSkillBySourcePathStmt.get(sourcePath) as SkillRow | null;
      return row ? toSkillRecord(row) : null;
    },

    async getSkillProposal(orgId, id) {
      const row = getSkillProposalStmt.get(
        orgId,
        id
      ) as SkillProposalRow | null;
      return row ? toSkillProposalRecord(row) : null;
    },

    async getSkillSuggestion(orgId, id) {
      const row = getSkillSuggestionStmt.get(
        orgId,
        id
      ) as SkillSuggestionRow | null;
      return row ? toSkillSuggestionRecord(row) : null;
    },

    async getSkillUsage(profileId, skillId) {
      const row = getSkillUsageStmt.get(
        profileId,
        skillId
      ) as SkillUsageRow | null;
      return row ? toSkillUsageRecord(row) : null;
    },

    async getTask(id) {
      const row = getTaskStmt.get(id) as TaskRow | null;
      return row ? toTaskRecord(row) : null;
    },

    async getTool(id) {
      const row = getToolStmt.get(id) as ToolRow | null;
      return row ? toToolRecord(row) : null;
    },

    async getToolByName(name) {
      const row = getToolByNameStmt.get(name) as ToolRow | null;
      return row ? toToolRecord(row) : null;
    },
    async getUserByEmail(email) {
      const row = getUserByEmailStmt.get(email) as UserRow | null;
      return row ? toUserRecord(row) : null;
    },

    async getUserById(id) {
      const row = getUserByIdStmt.get(id) as UserRow | null;
      return row ? toUserRecord(row) : null;
    },

    async getUserContext(orgId, userId) {
      const row = getUserContextStmt.get(orgId, userId) as {
        user_context?: string | null;
      } | null;
      return row?.user_context ?? null;
    },

    async getWorkspaceSettings() {
      const row = getWorkspaceSettingsStmt.get(
        WORKSPACE_SETTINGS_ID
      ) as WorkspaceSettingsRow | null;
      return row ? toWorkspaceSettingsRecord(row) : null;
    },

    async incrementLlmTurnUsage(orgId, delta) {
      const updatedAt = new Date().toISOString();
      incrementLlmTurnUsageStmt.run(
        orgId,
        updatedAt.slice(0, 10),
        delta.optimized ? "omni" : "none",
        delta.inputTokens,
        delta.outputTokens,
        delta.estimated ? 1 : 0,
        updatedAt
      );
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
        updatedAt
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
        updatedAt
      );
    },

    async incrementSkillUsage(input) {
      const now = new Date().toISOString();
      incrementSkillUsageStmt.run(
        input.orgId,
        input.profileId,
        input.skillId,
        input.viewDelta ?? 0,
        input.useDelta ?? 0,
        input.patchDelta ?? 0,
        input.viewedAt ?? null,
        input.usedAt ?? null,
        input.patchedAt ?? null,
        now,
        now
      );
    },

    async incrementToolOutputSavings(orgId, delta, trackedSince) {
      const updatedAt = new Date().toISOString();
      incrementToolOutputSavingsStmt.run(
        orgId,
        updatedAt.slice(0, 10),
        delta.optimizer,
        delta.tool,
        delta.bytesIn,
        delta.bytesOut,
        trackedSince,
        updatedAt
      );
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
        record.createdAt
      );
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
        record.deliveryError ?? null
      );
    },

    async insertTaskRun(record) {
      insertTaskRunStmt.run(
        record.id,
        record.taskId,
        record.status,
        record.startedAt,
        record.completedAt,
        record.output,
        record.error
      );
    },

    async listAutomationRuns(automationId, limit = 20) {
      return listAutomationRunsStmt
        .all(automationId, limit)
        .map((row) => toAutomationRunRecord(row as AutomationRunRow));
    },

    async listAutomations() {
      return listAutomationsStmt
        .all()
        .map((row) => toAutomationRecord(row as AutomationRow));
    },

    async listAutomationsForOrg(orgId) {
      return listAutomationsForOrgStmt
        .all(orgId)
        .map((row) => toAutomationRecord(row as AutomationRow));
    },

    async listComposioToolkitsForOrg(orgId) {
      return listComposioToolkitsForOrgStmt
        .all(orgId)
        .map((row) => toComposioToolkitRecord(row as ComposioToolkitRow));
    },

    async listComposioUserConnectionsForUser(orgId, userId) {
      return listComposioUserConnectionsForUserStmt
        .all(orgId, userId)
        .map((row) =>
          toComposioUserConnectionRecord(row as ComposioUserConnectionRow)
        );
    },

    async listLlmTurnUsage(orgId) {
      return (
        listLlmTurnUsageStmt.all(orgId) as {
          arm: string;
          bucket: string;
          estimated_turns: number;
          input_tokens: number;
          org_id: string;
          output_tokens: number;
          turns: number;
        }[]
      ).map((row) => ({
        arm: row.arm,
        bucket: row.bucket,
        estimatedTurns: row.estimated_turns,
        inputTokens: row.input_tokens,
        orgId: row.org_id,
        outputTokens: row.output_tokens,
        turns: row.turns,
      }));
    },

    async listLlmUsageStatsByModel() {
      return listLlmUsageStatsByModelStmt
        .all()
        .map((row) => toLlmUsageModelStatsRecord(row as LlmUsageModelStatsRow));
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

    async listMcpServers() {
      return listMcpServersStmt
        .all()
        .map((row) => toMcpServerRecord(row as McpServerRow));
    },

    async listMcpServersForProfile(profileId) {
      return listMcpServersForProfileStmt
        .all(profileId)
        .map((row) => toMcpServerRecord(row as McpServerRow));
    },

    async listMessagesForSession(sessionId) {
      return listMessagesForSessionStmt
        .all(sessionId)
        .map((row) => toSessionMessageRecord(row as SessionMessageRow));
    },

    async listNotificationDestinationsForOrg(orgId) {
      return listNotificationDestinationsForOrgStmt
        .all(orgId)
        .map((row) =>
          toNotificationDestinationRecord(row as NotificationDestinationRow)
        );
    },

    async listOrganizations() {
      return listOrganizationsStmt
        .all()
        .map((row) => toOrganizationRecord(row as OrganizationRow));
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
          createdAt: member.created_at,
          orgId: member.org_id,
          role: member.role as StoredOrgMemberRecord["role"],
          userContext: member.user_context ?? null,
          userId: member.user_id,
        };
      });
    },

    async listOrgMemoryProposals(orgId, status) {
      const rows = (
        status
          ? listOrgMemoryProposalsStmt.all(orgId, status)
          : listAllOrgMemoryProposalsStmt.all(orgId)
      ) as OrgMemoryProposalRow[];
      return rows.map(toOrgMemoryProposalRecord);
    },

    async listProfileComposioToolkits(profileId) {
      return listProfileComposioToolkitsStmt
        .all(profileId)
        .map((row) =>
          toProfileComposioToolkitRecord(row as ProfileComposioToolkitRow)
        );
    },

    async listProfiles() {
      return listProfilesStmt
        .all()
        .map((row) => toProfileRecord(row as ProfileRow));
    },

    async listProfilesForMcpServer(serverId) {
      return listProfilesForMcpServerStmt
        .all(serverId)
        .map((row) => toProfileRecord(row as ProfileRow));
    },

    async listProfilesForOrg(orgId) {
      return listProfilesForOrgStmt
        .all(orgId)
        .map((row) => toProfileRecord(row as ProfileRow));
    },

    async listSessionSummaries(profileId, channel) {
      return listSessionSummariesStmt
        .all(profileId, channel)
        .map((row) => toSessionSummaryRecord(row as SessionSummaryRow));
    },

    async listSessions() {
      return listSessionsStmt
        .all()
        .map((row) => toSessionRecord(row as SessionRow));
    },

    async listSkillProposals(orgId, options = {}) {
      const { status, profileId, sessionId } = options;
      let rows: SkillProposalRow[];
      if (status && profileId) {
        rows = listSkillProposalsByStatusAndProfileStmt.all(
          orgId,
          status,
          profileId
        ) as SkillProposalRow[];
      } else if (status) {
        rows = listSkillProposalsByStatusStmt.all(
          orgId,
          status
        ) as SkillProposalRow[];
      } else if (profileId) {
        rows = listAllSkillProposalsForProfileStmt.all(
          orgId,
          profileId
        ) as SkillProposalRow[];
      } else {
        rows = listAllSkillProposalsStmt.all(orgId) as SkillProposalRow[];
      }
      const records = rows.map(toSkillProposalRecord);
      if (!sessionId) {
        return records;
      }
      return records.filter((proposal) => proposal.sessionId === sessionId);
    },

    async listSkillSuggestions(orgId, options = {}) {
      const { sessionId, status, profileId } = options;
      const conditions = ["org_id = ?"];
      const params: string[] = [orgId];

      if (sessionId) {
        conditions.push("session_id = ?");
        params.push(sessionId);
      }
      if (status) {
        conditions.push("status = ?");
        params.push(status);
      }
      if (profileId) {
        conditions.push("profile_id = ?");
        params.push(profileId);
      }

      const sql = `
        SELECT
          id, org_id, profile_id, session_id, proposed_by_user_id,
          action, skill_name, content, patch_old_string, patch_new_string,
          status, source, warnings, created_at, applied_at
        FROM skill_suggestions
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC
      `;
      const rows = db.query(sql).all(...params) as SkillSuggestionRow[];
      return rows.map(toSkillSuggestionRecord);
    },

    async listSkills() {
      return listSkillsStmt.all().map((row) => toSkillRecord(row as SkillRow));
    },

    async listSkillsForProfile(profileId) {
      return listSkillsForProfileStmt
        .all(profileId)
        .map((row) => toSkillRecord(row as SkillRow));
    },

    async listSkillUsageForProfile(profileId) {
      return listSkillUsageForProfileStmt
        .all(profileId)
        .map((row) => toSkillUsageRecord(row as SkillUsageRow));
    },

    async listTaskRuns(taskId, limit = 20) {
      return listTaskRunsStmt
        .all(taskId, limit)
        .map((row) => toTaskRunRecord(row as TaskRunRow));
    },

    async listTasks() {
      return listTasksStmt.all().map((row) => toTaskRecord(row as TaskRow));
    },

    async listTasksForOrg(orgId) {
      return listTasksForOrgStmt
        .all(orgId)
        .map((row) => toTaskRecord(row as TaskRow));
    },

    async listToolOutputSavings(orgId) {
      return (
        listToolOutputSavingsStmt.all(orgId) as {
          bucket: string;
          bytes_in: number;
          bytes_out: number;
          calls: number;
          optimizer: string;
          org_id: string;
          tool: string;
          tracked_since: string;
          updated_at: string;
        }[]
      ).map((row) => ({
        bucket: row.bucket,
        bytesIn: row.bytes_in,
        bytesOut: row.bytes_out,
        calls: row.calls,
        optimizer: row.optimizer,
        orgId: row.org_id,
        tool: row.tool,
        trackedSince: row.tracked_since,
        updatedAt: row.updated_at,
      }));
    },

    async listTools() {
      return listToolsStmt.all().map((row) => toToolRecord(row as ToolRow));
    },

    async listToolsForProfile(profileId) {
      return listToolsForProfileStmt
        .all(profileId)
        .map((row) => toToolRecord(row as ToolRow));
    },

    async listUserOrganizations(userId) {
      return listUserOrganizationsStmt.all(userId).map((row) => {
        const record = row as OrganizationRow & {
          joined_at: string;
          role: string;
        };

        return {
          joinedAt: record.joined_at,
          organization: toOrganizationRecord(record),
          role: record.role as StoredUserOrganizationRecord["role"],
        };
      });
    },

    async markOrgInviteAccepted(id, acceptedAt) {
      markOrgInviteAcceptedStmt.run(acceptedAt, id);
    },

    async markSkillSuggestionApplied(orgId, id, appliedAt) {
      const result = markSkillSuggestionAppliedStmt.run(appliedAt, orgId, id);
      return result.changes > 0;
    },

    async replaceMessagesForSession(sessionId, messages) {
      deleteMessagesForSessionStmt.run(sessionId);

      for (const message of messages) {
        appendMessageStmt.run(
          message.id,
          sessionId,
          message.seq,
          JSON.stringify(message.payload),
          message.createdAt
        );
      }
    },

    async replaceProfileComposioToolkits(profileId, assignments) {
      deleteProfileComposioToolkitsStmt.run(profileId);

      for (const assignment of assignments) {
        insertProfileComposioToolkitStmt.run(
          assignment.profileId,
          assignment.toolkitId,
          assignment.allowedActions
            ? JSON.stringify(assignment.allowedActions)
            : null
        );
      }
    },

    async revokeArtifactShare(id, revokedAt) {
      const result = revokeArtifactShareStmt.run(revokedAt, id);
      return result.changes > 0;
    },

    async revokeBrowserSessionBySessionTokenHash(sessionTokenHash, revokedAt) {
      const result = revokeBrowserSessionByTokenHashStmt.run(
        revokedAt,
        sessionTokenHash
      );
      return result.changes > 0;
    },

    async revokeBrowserSessionsForUser(userId, revokedAt) {
      const result = revokeBrowserSessionsForUserStmt.run(revokedAt, userId);
      return result.changes;
    },

    async setUserContext(orgId, userId, content, _updatedAt) {
      setUserContextStmt.run(content, orgId, userId);
    },

    async tryMarkOrganizationArchived(orgId, archivedAt) {
      const now = new Date().toISOString();
      const result = tryMarkOrganizationArchivedStmt.run(
        archivedAt,
        now,
        orgId
      );
      return result.changes > 0;
    },

    async unassignMcpServerFromProfile(profileId, serverId) {
      const result = unassignMcpServerStmt.run(profileId, serverId);
      return result.changes > 0;
    },

    async unassignSkillFromProfile(profileId, skillId) {
      const result = unassignSkillStmt.run(profileId, skillId);
      return result.changes > 0;
    },

    async unassignToolFromProfile(profileId, toolId) {
      const result = unassignToolStmt.run(profileId, toolId);
      return result.changes > 0;
    },

    async updateArtifactShareSnapshot(id, snapshot) {
      updateArtifactShareSnapshotStmt.run(
        snapshot.filename,
        snapshot.mimeType,
        snapshot.sizeBytes,
        snapshot.storagePath,
        id
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
        record.id
      );
    },

    async updateBrowserSessionActiveOrgId(id, activeOrgId) {
      updateBrowserSessionActiveOrgIdStmt.run(activeOrgId, id);
    },

    async updateBrowserSessionLastUsedAt(id, lastUsedAt) {
      updateBrowserSessionLastUsedAtStmt.run(lastUsedAt, id);
    },

    async updateOrgMemoryProposalStatus(orgId, id, update) {
      const result = updateOrgMemoryProposalStatusStmt.run(
        update.status,
        update.reviewerUserId,
        update.reviewedAt,
        update.pinned ? 1 : 0,
        orgId,
        id
      );
      return result.changes > 0;
    },

    async updateSessionModel(sessionId, model) {
      const result = updateSessionModelStmt.run(model, sessionId);
      return result.changes > 0;
    },

    async updateSessionQuestionnaire(sessionId, questionnaire) {
      updateSessionQuestionnaireStmt.run(
        questionnaire ? JSON.stringify(questionnaire) : null,
        sessionId
      );
    },

    async updateSessionTitle(sessionId, title) {
      const result = updateSessionTitleStmt.run(title, sessionId);
      return result.changes > 0;
    },

    async updateSessionTodos(sessionId, todos) {
      updateSessionTodosStmt.run(JSON.stringify(todos), sessionId);
    },

    async updateSkillProposalStatus(orgId, id, update) {
      const result = updateSkillProposalStatusStmt.run(
        update.status,
        update.reviewerUserId,
        update.reviewedAt,
        orgId,
        id
      );
      return result.changes > 0;
    },

    async updateTaskRun(record) {
      updateTaskRunStmt.run(
        record.status,
        record.completedAt,
        record.output,
        record.error,
        record.id
      );
    },

    async updateUserPassword(id, passwordHash, updatedAt) {
      updateUserPasswordStmt.run(passwordHash, updatedAt, id);
    },

    async updateUserProfile(id, profile, updatedAt) {
      updateUserProfileStmt.run(
        profile.name,
        profile.phone,
        profile.email ?? null,
        updatedAt,
        id
      );
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
        record.updatedAt
      );
    },

    async upsertAutomationRunReadThrough(
      userId,
      orgId,
      automationId,
      readThroughAt
    ) {
      upsertAutomationRunReadThroughStmt.run(
        userId,
        orgId,
        automationId,
        readThroughAt
      );
    },

    async upsertComposioToolkit(record) {
      upsertComposioToolkitStmt.run(
        record.id,
        record.orgId,
        record.toolkitSlug,
        record.displayName,
        record.status,
        null,
        null,
        null,
        JSON.stringify(record.cachedTools),
        record.lastError,
        record.createdAt,
        record.updatedAt
      );
    },

    async upsertComposioUserConnection(record) {
      upsertComposioUserConnectionStmt.run(
        record.id,
        record.orgId,
        record.userId,
        record.toolkitId,
        record.status,
        record.connectedAccountId,
        record.sessionIdEnc,
        record.oauthStateHash,
        record.lastError,
        record.createdAt,
        record.updatedAt
      );
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
        record.updatedAt
      );
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
        record.updatedAt
      );
    },

    async upsertOrganization(record) {
      upsertOrganizationStmt.run(
        record.id,
        record.name,
        record.slug,
        record.skillsWriteApproval ? 1 : 0,
        record.skillsPostTurnReview ? 1 : 0,
        record.skillsCuratorEnabled ? 1 : 0,
        record.skillsCuratorStaleAfterDays ?? 30,
        record.skillsCuratorArchiveAfterDays ?? 90,
        record.skillsCuratorConsolidateEnabled ? 1 : 0,
        record.skillsCuratorLastRunAt ?? null,
        record.archivedAt ?? null,
        record.createdAt,
        record.updatedAt
      );
    },

    async upsertOrgMember(record) {
      upsertOrgMemberStmt.run(
        record.orgId,
        record.userId,
        record.role,
        record.userContext ?? null,
        record.createdAt
      );
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
        record.skillsWriteApproval == null
          ? null
          : record.skillsWriteApproval
            ? 1
            : 0,
        record.skillsPostTurnReview == null
          ? null
          : record.skillsPostTurnReview
            ? 1
            : 0,
        record.skillsCuratorConsolidateEnabled == null
          ? null
          : record.skillsCuratorConsolidateEnabled
            ? 1
            : 0,
        record.createdAt,
        record.updatedAt
      );
    },

    async upsertSession(record) {
      upsertSessionStmt.run(
        record.id,
        record.profileId,
        record.channel,
        record.createdAt,
        record.userId ?? null,
        record.model
      );
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
        record.createdBy,
        record.orgId ?? null,
        record.createdAt,
        record.updatedAt
      );
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
        record.updatedAt
      );
    },

    async upsertTool(record) {
      upsertToolStmt.run(
        record.id,
        record.name,
        record.description,
        record.handlerType,
        JSON.stringify(record.handlerConfig ?? {}),
        record.createdAt,
        record.updatedAt
      );
    },

    async upsertWorkspaceSettings(record) {
      upsertWorkspaceSettingsStmt.run(
        record.id,
        record.visionModel,
        record.transcriptionModel,
        record.imageModel,
        JSON.stringify(record.codingAgentHarnesses),
        record.selectedCodingAgentHarness,
        record.tokenOptimizerEnabled === null ||
          record.tokenOptimizerEnabled === undefined
          ? null
          : Number(record.tokenOptimizerEnabled),
        record.codingAgentProviderPassthrough === false ? 0 : 1,
        record.automationWorkerPollIntervalMs,
        record.updatedAt
      );
    },
  };
}

function toAutomationRecord(row: AutomationRow): StoredAutomationRecord {
  return {
    createdAt: row.created_at,
    definition: parseJson(row.definition),
    enabled: row.enabled !== 0,
    id: row.id,
    name: row.name,
    orgId: row.org_id ?? null,
    profileId: row.profile_id,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function toAutomationRunRecord(
  row: AutomationRunRow
): StoredAutomationRunRecord {
  return {
    automationId: row.automation_id,
    completedAt: row.completed_at,
    deliveryError: row.delivery_error,
    deliveryStatus: row.delivery_status,
    error: row.error,
    id: row.id,
    output: row.output,
    startedAt: row.started_at,
    status: row.status as StoredAutomationRunRecord["status"],
  };
}

function toProfileRecord(row: ProfileRow): StoredProfileRecord {
  return {
    createdAt: row.created_at,
    id: row.id,
    isDefault: row.is_default !== 0,
    isSuper: row.is_super !== 0,
    model: row.model,
    name: row.name,
    orgId: row.org_id ?? null,
    skillsCuratorConsolidateEnabled:
      row.skills_curator_consolidate_enabled == null
        ? null
        : row.skills_curator_consolidate_enabled !== 0,
    skillsPostTurnReview:
      row.skills_post_turn_review == null
        ? null
        : row.skills_post_turn_review !== 0,
    skillsWriteApproval:
      row.skills_write_approval == null
        ? null
        : row.skills_write_approval !== 0,
    systemPrompt: row.system_prompt,
    thinkingEffort:
      row.thinking_effort as StoredProfileRecord["thinkingEffort"],
    thinkingEnabled:
      row.thinking_enabled == null ? null : row.thinking_enabled !== 0,
    updatedAt: row.updated_at,
  };
}

function toSkillRecord(row: SkillRow): StoredSkillRecord {
  return {
    createdAt: row.created_at,
    createdBy: normalizeSkillCreatedBy(row.created_by),
    description: row.description,
    disableModelInvocation: row.disable_model_invocation !== 0,
    enabled: row.enabled !== 0,
    hasTool: row.has_tool !== 0,
    id: row.id,
    name: row.name,
    orgId: row.org_id ?? null,
    sourcePath: row.source_path,
    updatedAt: row.updated_at,
  };
}

function toSkillUsageRecord(row: SkillUsageRow): StoredSkillUsageRecord {
  return {
    createdAt: row.created_at,
    lastPatchedAt: row.last_patched_at,
    lastUsedAt: row.last_used_at,
    lastViewedAt: row.last_viewed_at,
    orgId: row.org_id,
    patchCount: row.patch_count,
    profileId: row.profile_id,
    skillId: row.skill_id,
    updatedAt: row.updated_at,
    useCount: row.use_count,
    viewCount: row.view_count,
  };
}

function normalizeSkillCreatedBy(
  value: string
): StoredSkillRecord["createdBy"] {
  if (value === "agent" || value === "human") {
    return value;
  }

  return "bundled";
}

function toMcpServerRecord(row: McpServerRow): StoredMcpServerRecord {
  return {
    cachedTools: parseJson(
      row.cached_tools
    ) as StoredMcpServerRecord["cachedTools"],
    config: parseJson(row.config),
    createdAt: row.created_at,
    enabled: row.enabled !== 0,
    id: row.id,
    lastError: row.last_error,
    name: row.name,
    status: row.status as StoredMcpServerRecord["status"],
    transport: row.transport as StoredMcpServerRecord["transport"],
    updatedAt: row.updated_at,
  };
}

function toToolRecord(row: ToolRow): StoredToolRecord {
  return {
    createdAt: row.created_at,
    description: row.description,
    handlerConfig: parseJson(row.handler_config),
    handlerType: row.handler_type,
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
  };
}

function parseAgentTodos(
  raw: string | null | undefined
): StoredSessionRecord["agentTodos"] {
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
        typeof (item as { status?: unknown }).status === "string"
    );
  } catch {
    return [];
  }
}

function parseAgentQuestionnaire(
  raw: string | null | undefined
): AgentQuestionnaire | null {
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
        typeof (item as { allowCustomAnswer?: unknown }).allowCustomAnswer ===
          "boolean" &&
        Array.isArray((item as { choices?: unknown }).choices) &&
        (item as { choices: unknown[] }).choices.every(
          (choice) =>
            typeof choice === "object" &&
            choice !== null &&
            typeof (choice as { id?: unknown }).id === "string" &&
            typeof (choice as { label?: unknown }).label === "string"
        ) &&
        ((item as { placeholder?: unknown }).placeholder === undefined ||
          typeof (item as { placeholder?: unknown }).placeholder === "string")
    );

    if (validQuestions.length !== questions.length) {
      return null;
    }

    return {
      id: record.id,
      questions: validQuestions,
      title: record.title,
    };
  } catch {
    return null;
  }
}

function toSessionRecord(row: SessionRow): StoredSessionRecord {
  return {
    agentQuestionnaire: parseAgentQuestionnaire(row.agent_questionnaire),
    agentTodos: parseAgentTodos(row.agent_todos),
    channel: row.channel,
    createdAt: row.created_at,
    id: row.id,
    model: row.model ?? null,
    profileId: row.profile_id,
    title: row.title ?? null,
    userId: row.user_id ?? null,
  };
}

function toSessionMessageRecord(
  row: SessionMessageRow
): StoredSessionMessageRecord {
  return {
    createdAt: row.created_at,
    id: row.id,
    payload: parseJson(row.payload),
    seq: row.seq,
    sessionId: row.session_id,
  };
}

function toAttachmentRecord(row: AttachmentRow): StoredAttachmentRecord {
  return {
    channel: row.channel,
    createdAt: row.created_at,
    filename: row.filename,
    id: row.id,
    kind: row.kind as StoredAttachmentRecord["kind"],
    mediaType: row.media_type,
    orgId: row.org_id,
    profileId: row.profile_id,
    sessionId: row.session_id,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
  };
}

function toTaskRecord(row: TaskRow): StoredTaskRecord {
  return {
    createdAt: row.created_at,
    description: row.description,
    id: row.id,
    orgId: row.org_id ?? null,
    position: row.position,
    profileId: row.profile_id,
    prompt: row.prompt,
    sessionId: row.session_id,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

function toTaskRunRecord(row: TaskRunRow): StoredTaskRunRecord {
  return {
    completedAt: row.completed_at,
    error: row.error,
    id: row.id,
    output: row.output,
    startedAt: row.started_at,
    status: row.status as StoredTaskRunRecord["status"],
    taskId: row.task_id,
  };
}

function previewFromFirstUserPayload(
  payloadJson: string | null
): string | null {
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

function toSessionSummaryRecord(
  row: SessionSummaryRow
): StoredSessionSummaryRecord {
  return {
    channel: row.channel,
    createdAt: row.created_at,
    id: row.id,
    messageCount: row.message_count,
    preview: previewFromFirstUserPayload(row.first_user_payload),
    profileId: row.profile_id,
    title: row.title ?? null,
    updatedAt: row.updated_at,
  };
}

function toLlmUsageStatsRecord(
  row: LlmUsageStatsRow
): StoredLlmUsageStatsRecord {
  return {
    estimatedCostUsd: row.estimated_cost_usd,
    id: row.id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    requestCount: row.request_count,
    trackedSince: row.tracked_since,
    updatedAt: row.updated_at,
  };
}

function toLlmUsageModelStatsRecord(
  row: LlmUsageModelStatsRow
): StoredLlmUsageModelStatsRecord {
  return {
    estimatedCostUsd: row.estimated_cost_usd,
    inputTokens: row.input_tokens,
    modelId: row.model_id,
    outputTokens: row.output_tokens,
    requestCount: row.request_count,
    trackedSince: row.tracked_since,
    updatedAt: row.updated_at,
  };
}

function toWorkspaceSettingsRecord(
  row: WorkspaceSettingsRow
): StoredWorkspaceSettingsRecord {
  return {
    automationWorkerPollIntervalMs: row.automation_worker_poll_interval_ms,
    codingAgentHarnesses: parseCodingAgentHarnesses(row.coding_agent_harnesses),
    codingAgentProviderPassthrough: row.coding_agent_provider_passthrough !== 0,
    id: row.id,
    imageModel: row.image_model?.trim() || null,
    selectedCodingAgentHarness:
      row.selected_coding_agent_harness?.trim() || null,
    tokenOptimizerEnabled:
      row.token_optimizer_enabled === null ||
      row.token_optimizer_enabled === undefined
        ? null
        : row.token_optimizer_enabled === 1,
    transcriptionModel: row.transcription_model?.trim() || null,
    updatedAt: row.updated_at,
    visionModel: row.vision_model?.trim() || null,
  };
}

function parseCodingAgentHarnessProbeCache(
  raw: unknown
): StoredWorkspaceSettingsRecord["codingAgentHarnesses"][number]["probeCache"] {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const cache = raw as Record<string, unknown>;
  const checkedAt =
    typeof cache.checkedAt === "string" ? cache.checkedAt.trim() : "";
  const nextStep = cache.nextStep;

  if (!checkedAt) {
    return null;
  }

  if (
    nextStep !== null &&
    nextStep !== "install" &&
    nextStep !== "login" &&
    nextStep !== "retry"
  ) {
    return null;
  }

  const normalizedNextStep = nextStep === "login" ? "retry" : nextStep;

  return {
    authenticated:
      typeof cache.authenticated === "boolean"
        ? cache.authenticated
        : cache.authenticated === null
          ? null
          : null,
    checkedAt,
    nextStep: normalizedNextStep,
    ready: cache.ready === true,
    statusMessage:
      typeof cache.statusMessage === "string"
        ? cache.statusMessage
        : cache.statusMessage === null
          ? null
          : null,
  };
}

function parseCodingAgentHarnesses(
  raw: string | null | undefined
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
      const command =
        typeof harness.command === "string" ? harness.command.trim() : "";
      const args = Array.isArray(harness.args)
        ? harness.args.filter(
            (value): value is string => typeof value === "string"
          )
        : [];

      if (!(id && name && command)) {
        return [];
      }

      if (
        kind !== "codex" &&
        kind !== "claude_code" &&
        kind !== "opencode" &&
        kind !== "pi" &&
        kind !== "cursor_agent"
      ) {
        return [];
      }

      const probeCache = parseCodingAgentHarnessProbeCache(harness.probeCache);

      return [
        {
          args,
          command,
          enabled: harness.enabled !== false,
          id,
          kind,
          name,
          ...(probeCache ? { probeCache } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

function toNotificationDestinationRecord(
  row: NotificationDestinationRow
): StoredNotificationDestinationRecord {
  return {
    channel: row.channel,
    config: JSON.parse(
      row.config
    ) as StoredNotificationDestinationRecord["config"],
    createdAt: row.created_at,
    id: row.id,
    name: row.name,
    orgId: row.org_id,
    secretHash: row.secret_hash,
    updatedAt: row.updated_at,
  };
}

function normalizeOrgComposioToolkitStatus(
  status: string
): StoredComposioToolkitRecord["status"] {
  return status === "disabled" ? "disabled" : "enabled";
}

function toComposioToolkitRecord(
  row: ComposioToolkitRow
): StoredComposioToolkitRecord {
  return {
    cachedTools: JSON.parse(
      row.cached_tools
    ) as StoredComposioToolkitRecord["cachedTools"],
    createdAt: row.created_at,
    displayName: row.display_name,
    id: row.id,
    lastError: row.last_error,
    orgId: row.org_id,
    status: normalizeOrgComposioToolkitStatus(row.status),
    toolkitSlug: row.toolkit_slug,
    updatedAt: row.updated_at,
  };
}

function toComposioUserConnectionRecord(
  row: ComposioUserConnectionRow
): StoredComposioUserConnectionRecord {
  return {
    connectedAccountId: row.connected_account_id,
    createdAt: row.created_at,
    id: row.id,
    lastError: row.last_error,
    oauthStateHash: row.oauth_state_hash,
    orgId: row.org_id,
    sessionIdEnc: row.session_id_enc,
    status: row.status as StoredComposioUserConnectionRecord["status"],
    toolkitId: row.toolkit_id,
    updatedAt: row.updated_at,
    userId: row.user_id,
  };
}

function toProfileComposioToolkitRecord(
  row: ProfileComposioToolkitRow
): StoredProfileComposioToolkitRecord {
  return {
    allowedActions: row.allowed_actions
      ? (JSON.parse(row.allowed_actions) as string[])
      : null,
    profileId: row.profile_id,
    toolkitId: row.toolkit_id,
  };
}

function toUserRecord(row: UserRow): StoredUserRecord {
  return {
    createdAt: row.created_at,
    email: row.email,
    id: row.id,
    isPlatformAdmin: Boolean(row.is_platform_admin),
    name: row.name ?? null,
    passwordHash: row.password_hash,
    phone: row.phone ?? null,
    updatedAt: row.updated_at,
  };
}

function toOrganizationRecord(row: OrganizationRow): StoredOrganizationRecord {
  return {
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    id: row.id,
    name: row.name,
    skillsCuratorArchiveAfterDays: row.skills_curator_archive_after_days,
    skillsCuratorConsolidateEnabled:
      row.skills_curator_consolidate_enabled !== 0,
    skillsCuratorEnabled: row.skills_curator_enabled !== 0,
    skillsCuratorLastRunAt: row.skills_curator_last_run_at,
    skillsCuratorStaleAfterDays: row.skills_curator_stale_after_days,
    skillsPostTurnReview: row.skills_post_turn_review !== 0,
    skillsWriteApproval: row.skills_write_approval !== 0,
    slug: row.slug,
    updatedAt: row.updated_at,
  };
}

function toOrgInviteRecord(row: OrgInviteRow): StoredOrgInviteRecord {
  return {
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    email: row.email,
    expiresAt: row.expires_at,
    id: row.id,
    invitedByUserId: row.invited_by_user_id,
    orgId: row.org_id,
    revokedAt: row.revoked_at,
    role: row.role as StoredOrgInviteRecord["role"],
    tokenHash: row.token_hash,
  };
}

function toOrgMemoryProposalRecord(
  row: OrgMemoryProposalRow
): StoredOrgMemoryProposal {
  return {
    bullet: row.bullet,
    createdAt: row.created_at,
    id: row.id,
    orgId: row.org_id,
    pinned: Boolean(row.pinned),
    profileId: row.profile_id,
    proposedByUserId: row.proposed_by_user_id,
    reviewedAt: row.reviewed_at,
    reviewerUserId: row.reviewer_user_id,
    sessionId: row.session_id,
    status: row.status as OrgMemoryProposalStatus,
  };
}

function toSkillProposalRecord(row: SkillProposalRow): StoredSkillProposal {
  let consolidateLoserSkillNames: string[] | null = null;
  if (row.consolidate_loser_skill_names) {
    try {
      const parsed = JSON.parse(row.consolidate_loser_skill_names) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === "string")
      ) {
        consolidateLoserSkillNames = parsed;
      }
    } catch {
      consolidateLoserSkillNames = null;
    }
  }

  return {
    action: row.action as StoredSkillProposal["action"],
    consolidateLoserSkillNames,
    content: row.content,
    createdAt: row.created_at,
    id: row.id,
    orgId: row.org_id,
    patchNewString: row.patch_new_string,
    patchOldString: row.patch_old_string,
    profileId: row.profile_id,
    proposedByUserId: row.proposed_by_user_id,
    relativePath: row.relative_path,
    reviewedAt: row.reviewed_at,
    reviewerUserId: row.reviewer_user_id,
    sessionId: row.session_id,
    skillName: row.skill_name,
    status: row.status as StoredSkillProposal["status"],
  };
}

function toSkillSuggestionRecord(
  row: SkillSuggestionRow
): StoredSkillSuggestion {
  return {
    action: row.action as StoredSkillSuggestion["action"],
    appliedAt: row.applied_at,
    content: row.content,
    createdAt: row.created_at,
    id: row.id,
    orgId: row.org_id,
    patchNewString: row.patch_new_string,
    patchOldString: row.patch_old_string,
    profileId: row.profile_id,
    proposedByUserId: row.proposed_by_user_id,
    sessionId: row.session_id,
    skillName: row.skill_name,
    source: row.source as StoredSkillSuggestion["source"],
    status: row.status as StoredSkillSuggestion["status"],
    warnings: row.warnings ? (JSON.parse(row.warnings) as string[]) : null,
  };
}

function toArtifactShareRecord(
  row: ArtifactShareRow
): StoredArtifactShareRecord {
  return {
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
    filename: row.filename,
    id: row.id,
    mimeType: row.mime_type,
    orgId: row.org_id,
    profileId: row.profile_id,
    revokedAt: row.revoked_at,
    sizeBytes: row.size_bytes,
    sourcePath: row.source_path,
    storagePath: row.storage_path,
    tokenHash: row.token_hash,
  };
}

function toBrowserSessionRecord(
  row: BrowserSessionRow
): StoredBrowserSessionRecord {
  return {
    activeOrgId: row.active_org_id ?? null,
    createdAt: row.created_at,
    csrfTokenHash: row.csrf_token_hash,
    expiresAt: row.expires_at,
    id: row.id,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    sessionTokenHash: row.session_token_hash,
    userId: row.user_id,
  };
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
