import type { AgentTodo, OrgRole, ThinkingEffort } from "@tinyclaw/core";

export type { OrgRole } from "@tinyclaw/core";
export type ChannelType = "telegram" | "whatsapp";

export type AutomationRunStatus = "running" | "completed" | "failed";

export interface StoredAutomationRecord {
  id: string;
  name: string;
  version: number;
  definition: unknown;
  profileId: string;
  enabled: boolean;
  orgId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAutomationRunRecord {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  startedAt: string;
  completedAt: string | null;
  output: string | null;
  error: string | null;
}

export interface StoredProfileRecord {
  id: string;
  name: string;
  systemPrompt: string;
  model: string | null;
  thinkingEnabled?: boolean | null;
  thinkingEffort?: ThinkingEffort | null;
  isSuper: boolean;
  orgId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredToolRecord {
  id: string;
  name: string;
  description: string;
  handlerType: string;
  handlerConfig: unknown;
  orgId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredSessionRecord {
  id: string;
  profileId: string;
  channel: string;
  orgId?: string | null;
  createdAt: string;
  title: string | null;
  agentTodos: AgentTodo[];
}

export interface StoredSessionMessageRecord {
  id: string;
  sessionId: string;
  seq: number;
  payload: unknown;
  createdAt: string;
}

export interface StoredSessionSummaryRecord {
  id: string;
  profileId: string;
  channel: string;
  orgId?: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  title: string | null;
  preview: string | null;
}

export interface StoredTaskRecord {
  id: string;
  title: string;
  description: string;
  prompt: string;
  profileId: string;
  status: string;
  position: number;
  sessionId?: string | null;
  orgId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TaskRunStatus = "running" | "completed" | "failed";

export interface StoredTaskRunRecord {
  id: string;
  taskId: string;
  status: TaskRunStatus;
  startedAt: string;
  completedAt: string | null;
  output: string | null;
  error: string | null;
}

export interface StoredLlmUsageStatsRecord {
  id: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  trackedSince: string;
  updatedAt: string;
  orgId?: string | null;
}

export interface StoredWorkspaceSettingsRecord {
  id: string;
  visionModel: string | null;
  updatedAt: string;
  orgId?: string | null;
}

export interface LlmUsageStatsDelta {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export type McpServerStatus = "connected" | "disconnected" | "error";
export type McpTransport = "http" | "stdio";

export interface CachedMcpTool {
  name: string;
  description: string;
  inputSchema?: unknown;
}

export interface StoredSkillRecord {
  id: string;
  name: string;
  description: string;
  sourcePath: string;
  hasTool: boolean;
  disableModelInvocation: boolean;
  enabled: boolean;
  orgId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMcpServerRecord {
  id: string;
  name: string;
  transport: McpTransport;
  config: unknown;
  enabled: boolean;
  status: McpServerStatus;
  lastError: string | null;
  cachedTools: CachedMcpTool[];
  orgId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  name?: string | null;
  phone?: string | null;
  isPlatformAdmin?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredOrganizationRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredOrgMemberRecord {
  orgId: string;
  userId: string;
  role: OrgRole;
  createdAt: string;
}

export interface StoredUserOrganizationRecord {
  organization: StoredOrganizationRecord;
  role: OrgRole;
  joinedAt: string;
}

export interface StoredOrgInviteRecord {
  id: string;
  orgId: string;
  email: string;
  role: OrgRole;
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface StoredChannelOrgMappingRecord {
  channel: ChannelType;
  channelUserId: string;
  userId: string;
  orgId: string;
  createdAt: string;
}

export interface StoredBrowserSessionRecord {
  id: string;
  userId: string;
  sessionTokenHash: string;
  csrfTokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  activeOrgId?: string | null;
}

export interface DatabaseAdapter {
  getUserByEmail(email: string): Promise<StoredUserRecord | null>;
  getUserById(id: string): Promise<StoredUserRecord | null>;
  createUser(record: StoredUserRecord): Promise<void>;
  updateUserPassword(id: string, passwordHash: string, updatedAt: string): Promise<void>;
  countUsers(): Promise<number>;

  createBrowserSession(record: StoredBrowserSessionRecord): Promise<void>;
  getBrowserSessionBySessionTokenHash(
    sessionTokenHash: string,
  ): Promise<StoredBrowserSessionRecord | null>;
  revokeBrowserSessionBySessionTokenHash(sessionTokenHash: string, revokedAt: string): Promise<boolean>;
  updateBrowserSessionLastUsedAt(id: string, lastUsedAt: string): Promise<void>;
  updateBrowserSessionActiveOrgId(id: string, activeOrgId: string | null): Promise<void>;

  upsertOrganization(record: StoredOrganizationRecord): Promise<void>;
  listOrganizations(): Promise<StoredOrganizationRecord[]>;
  getOrganizationById(id: string): Promise<StoredOrganizationRecord | null>;
  getOrganizationBySlug(slug: string): Promise<StoredOrganizationRecord | null>;
  upsertOrgMember(record: StoredOrgMemberRecord): Promise<void>;
  getOrgMember(orgId: string, userId: string): Promise<StoredOrgMemberRecord | null>;
  listOrgMembers(orgId: string): Promise<StoredOrgMemberRecord[]>;
  listUserOrganizations(userId: string): Promise<StoredUserOrganizationRecord[]>;
  deleteOrgMember(orgId: string, userId: string): Promise<boolean>;

  createOrgInvite(record: StoredOrgInviteRecord): Promise<void>;
  getOrgInviteByTokenHash(tokenHash: string): Promise<StoredOrgInviteRecord | null>;
  getPendingOrgInvite(orgId: string, email: string): Promise<StoredOrgInviteRecord | null>;
  markOrgInviteAccepted(id: string, acceptedAt: string): Promise<void>;

  listAutomations(): Promise<StoredAutomationRecord[]>;
  getAutomation(id: string): Promise<StoredAutomationRecord | null>;
  upsertAutomation(record: StoredAutomationRecord): Promise<void>;
  deleteAutomation(id: string): Promise<boolean>;

  listAutomationRuns(automationId: string, limit?: number): Promise<StoredAutomationRunRecord[]>;
  getActiveAutomationRun(automationId: string): Promise<StoredAutomationRunRecord | null>;
  insertAutomationRun(record: StoredAutomationRunRecord): Promise<void>;
  updateAutomationRun(record: StoredAutomationRunRecord): Promise<void>;

  listProfiles(): Promise<StoredProfileRecord[]>;
  getProfile(id: string): Promise<StoredProfileRecord | null>;
  upsertProfile(record: StoredProfileRecord): Promise<void>;
  deleteProfile(id: string): Promise<boolean>;

  listTools(): Promise<StoredToolRecord[]>;
  getTool(id: string): Promise<StoredToolRecord | null>;
  getToolByName(name: string): Promise<StoredToolRecord | null>;
  upsertTool(record: StoredToolRecord): Promise<void>;
  deleteTool(id: string): Promise<boolean>;

  listToolsForProfile(profileId: string): Promise<StoredToolRecord[]>;
  assignToolToProfile(profileId: string, toolId: string): Promise<void>;
  unassignToolFromProfile(profileId: string, toolId: string): Promise<boolean>;

  listSessions(): Promise<StoredSessionRecord[]>;
  listSessionSummaries(
    profileId: string,
    channel: string,
  ): Promise<StoredSessionSummaryRecord[]>;
  getSession(id: string): Promise<StoredSessionRecord | null>;
  upsertSession(record: StoredSessionRecord): Promise<void>;
  updateSessionTitle(sessionId: string, title: string): Promise<boolean>;
  getSessionTodos(sessionId: string): Promise<AgentTodo[]>;
  updateSessionTodos(sessionId: string, todos: AgentTodo[]): Promise<void>;
  deleteSession(id: string): Promise<boolean>;

  listMessagesForSession(sessionId: string): Promise<StoredSessionMessageRecord[]>;
  appendMessagesForSession(
    sessionId: string,
    messages: StoredSessionMessageRecord[],
  ): Promise<void>;
  replaceMessagesForSession(
    sessionId: string,
    messages: StoredSessionMessageRecord[],
  ): Promise<void>;
  deleteMessagesForSession(sessionId: string): Promise<void>;

  listTasks(): Promise<StoredTaskRecord[]>;
  getTask(id: string): Promise<StoredTaskRecord | null>;
  upsertTask(record: StoredTaskRecord): Promise<void>;
  deleteTask(id: string): Promise<boolean>;

  listTaskRuns(taskId: string, limit?: number): Promise<StoredTaskRunRecord[]>;
  getActiveTaskRun(taskId: string): Promise<StoredTaskRunRecord | null>;
  insertTaskRun(record: StoredTaskRunRecord): Promise<void>;
  updateTaskRun(record: StoredTaskRunRecord): Promise<void>;

  getLlmUsageStats(): Promise<StoredLlmUsageStatsRecord | null>;
  incrementLlmUsageStats(
    delta: LlmUsageStatsDelta,
    trackedSince: string,
  ): Promise<void>;

  getWorkspaceSettings(): Promise<StoredWorkspaceSettingsRecord | null>;
  upsertWorkspaceSettings(record: StoredWorkspaceSettingsRecord): Promise<void>;

  listMcpServers(): Promise<StoredMcpServerRecord[]>;
  getMcpServer(id: string): Promise<StoredMcpServerRecord | null>;
  getMcpServerByName(name: string): Promise<StoredMcpServerRecord | null>;
  upsertMcpServer(record: StoredMcpServerRecord): Promise<void>;
  deleteMcpServer(id: string): Promise<boolean>;

  listMcpServersForProfile(profileId: string): Promise<StoredMcpServerRecord[]>;
  assignMcpServerToProfile(profileId: string, serverId: string): Promise<void>;
  unassignMcpServerFromProfile(profileId: string, serverId: string): Promise<boolean>;
  countProfileMcpAssignments(): Promise<number>;

  listSkills(): Promise<StoredSkillRecord[]>;
  getSkill(id: string): Promise<StoredSkillRecord | null>;
  getSkillByName(name: string): Promise<StoredSkillRecord | null>;
  getSkillBySourcePath(sourcePath: string): Promise<StoredSkillRecord | null>;
  upsertSkill(record: StoredSkillRecord): Promise<void>;
  deleteSkill(id: string): Promise<boolean>;

  listSkillsForProfile(profileId: string): Promise<StoredSkillRecord[]>;
  assignSkillToProfile(profileId: string, skillId: string): Promise<void>;
  unassignSkillFromProfile(profileId: string, skillId: string): Promise<boolean>;
}
