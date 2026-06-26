PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  system_prompt TEXT DEFAULT '' NOT NULL,
  model TEXT,
  thinking_enabled INTEGER,
  thinking_effort TEXT,
  is_super INTEGER DEFAULT 0 NOT NULL,
  org_id TEXT,
  is_default INTEGER DEFAULT 0 NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  handler_type TEXT NOT NULL,
  handler_config TEXT DEFAULT '{}' NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS tools_name_unique ON tools (name);

CREATE TABLE IF NOT EXISTS profile_tools (
  profile_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  PRIMARY KEY (profile_id, tool_id),
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,
  FOREIGN KEY (tool_id) REFERENCES tools (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL,
  title TEXT,
  agent_todos TEXT DEFAULT '[]' NOT NULL,
  agent_questionnaire TEXT,
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS session_messages (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS session_messages_session_seq
  ON session_messages (session_id, seq);

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

CREATE INDEX IF NOT EXISTS attachments_session_id ON attachments (session_id);

CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  org_id TEXT,
  enabled INTEGER DEFAULT 1 NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY NOT NULL,
  automation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  output TEXT,
  error TEXT,
  FOREIGN KEY (automation_id) REFERENCES automations (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS automation_runs_automation_started
  ON automation_runs (automation_id, started_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '' NOT NULL,
  prompt TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  org_id TEXT,
  status TEXT NOT NULL DEFAULT 'backlog',
  position INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS tasks_status_position
  ON tasks (status, position);

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  output TEXT,
  error TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS task_runs_task_started
  ON task_runs (task_id, started_at DESC);

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

CREATE UNIQUE INDEX IF NOT EXISTS skills_source_path_unique ON skills (source_path);

CREATE TABLE IF NOT EXISTS profile_skills (
  profile_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  PRIMARY KEY (profile_id, skill_id),
  FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS llm_usage_stats (
  id TEXT PRIMARY KEY NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  tracked_since TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_usage_model_stats (
  model_id TEXT PRIMARY KEY NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  tracked_since TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  is_platform_admin INTEGER DEFAULT 0 NOT NULL,
  user_context TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);

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

CREATE TABLE IF NOT EXISTS workspace_settings (
  id TEXT PRIMARY KEY NOT NULL,
  vision_model TEXT,
  updated_at TEXT NOT NULL
);
