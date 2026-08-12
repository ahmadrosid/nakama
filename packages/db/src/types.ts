import type {
  AgentQuestionnaire,
  AgentTodo,
  OrgRole,
  ThinkingEffort,
} from "@nakama/core";

export type { OrgRole } from "@nakama/core";
export type ChannelType = "telegram" | "whatsapp";

export type AutomationRunStatus = "running" | "completed" | "failed";

export interface StoredAutomationRecord {
  createdAt: string;
  definition: unknown;
  enabled: boolean;
  id: string;
  name: string;
  orgId?: string | null;
  profileId: string;
  updatedAt: string;
  version: number;
}

export interface StoredAutomationRunRecord {
  automationId: string;
  completedAt: string | null;
  deliveryError?: string | null;
  deliveryStatus?: string | null;
  error: string | null;
  id: string;
  output: string | null;
  startedAt: string;
  status: AutomationRunStatus;
}

export interface AutomationUnreadCountRecord {
  automationId: string;
  unreadCount: number;
}

export interface StoredProfileRecord {
  createdAt: string;
  id: string;
  isDefault?: boolean;
  isSuper: boolean;
  model: string | null;
  name: string;
  orgId?: string | null;
  /** null = inherit org default; true/false = force post-turn review on/off for this profile */
  skillsPostTurnReview?: boolean | null;
  /** null = inherit org default; true/false = force gate on/off for this profile */
  skillsWriteApproval?: boolean | null;
  systemPrompt: string;
  thinkingEffort?: ThinkingEffort | null;
  thinkingEnabled?: boolean | null;
  updatedAt: string;
}

export interface StoredToolRecord {
  createdAt: string;
  description: string;
  handlerConfig: unknown;
  handlerType: string;
  id: string;
  name: string;
  orgId?: string | null;
  updatedAt: string;
}

export interface StoredSessionRecord {
  agentQuestionnaire: AgentQuestionnaire | null;
  agentTodos: AgentTodo[];
  channel: string;
  createdAt: string;
  id: string;
  orgId?: string | null;
  profileId: string;
  title: string | null;
  userId?: string | null;
}

export interface StoredSessionMessageRecord {
  createdAt: string;
  id: string;
  payload: unknown;
  seq: number;
  sessionId: string;
}

export type AttachmentKind = "image" | "document";

export interface StoredAttachmentRecord {
  channel: string;
  createdAt: string;
  filename: string | null;
  id: string;
  kind: AttachmentKind;
  mediaType: string;
  orgId: string | null;
  profileId: string;
  sessionId: string | null;
  sizeBytes: number;
  storagePath: string;
}

export interface StoredSessionSummaryRecord {
  channel: string;
  createdAt: string;
  id: string;
  messageCount: number;
  orgId?: string | null;
  preview: string | null;
  profileId: string;
  title: string | null;
  updatedAt: string;
}

export interface StoredTaskRecord {
  createdAt: string;
  description: string;
  id: string;
  orgId?: string | null;
  position: number;
  profileId: string;
  prompt: string;
  sessionId?: string | null;
  status: string;
  title: string;
  updatedAt: string;
}

export type TaskRunStatus = "running" | "completed" | "failed";

export interface StoredTaskRunRecord {
  completedAt: string | null;
  error: string | null;
  id: string;
  output: string | null;
  startedAt: string;
  status: TaskRunStatus;
  taskId: string;
}

export interface StoredLlmUsageStatsRecord {
  estimatedCostUsd: number;
  id: string;
  inputTokens: number;
  orgId?: string | null;
  outputTokens: number;
  requestCount: number;
  trackedSince: string;
  updatedAt: string;
}

export interface StoredLlmUsageModelStatsRecord {
  estimatedCostUsd: number;
  inputTokens: number;
  modelId: string;
  orgId?: string | null;
  outputTokens: number;
  requestCount: number;
  trackedSince: string;
  updatedAt: string;
}

export interface StoredWorkspaceSettingsRecord {
  codingAgentHarnesses: StoredCodingAgentHarnessRecord[];
  id: string;
  imageModel: string | null;
  orgId?: string | null;
  selectedCodingAgentHarness: string | null;
  /** null = inherit the NAKAMA_OMNI env var; true/false = set explicitly here. */
  tokenOptimizerEnabled?: boolean | null;
  transcriptionModel: string | null;
  updatedAt: string;
  visionModel: string | null;
}

export type StoredCodingAgentHarnessKind =
  | "codex"
  | "claude_code"
  | "opencode"
  | "pi"
  | "cursor_agent";

export interface StoredCodingAgentHarnessProbeCache {
  authenticated: boolean | null;
  checkedAt: string;
  nextStep: "install" | "retry" | null;
  ready: boolean;
  statusMessage: string | null;
}

export interface StoredCodingAgentHarnessRecord {
  args: string[];
  command: string;
  enabled: boolean;
  id: string;
  kind: StoredCodingAgentHarnessKind;
  name: string;
  probeCache?: StoredCodingAgentHarnessProbeCache | null;
}

export interface StoredNotificationDestinationRecord {
  channel: "telegram";
  config: {
    chatId: number;
    topicId?: number | null;
  };
  createdAt: string;
  id: string;
  name: string;
  orgId: string;
  secretHash: string;
  updatedAt: string;
}

export type StoredOrgComposioToolkitStatus = "disabled" | "enabled";

/** @deprecated Use StoredOrgComposioToolkitStatus for org catalog rows. */
export type StoredComposioToolkitStatus =
  | StoredOrgComposioToolkitStatus
  | "oauth_in_progress"
  | "connected"
  | "error";

export interface StoredComposioToolkitRecord {
  cachedTools: Array<{
    slug: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  createdAt: string;
  displayName: string;
  id: string;
  lastError: string | null;
  orgId: string;
  status: StoredOrgComposioToolkitStatus;
  toolkitSlug: string;
  updatedAt: string;
}

export type StoredComposioUserConnectionStatus =
  | "oauth_in_progress"
  | "connected"
  | "error";

export interface StoredComposioUserConnectionRecord {
  connectedAccountId: string | null;
  createdAt: string;
  id: string;
  lastError: string | null;
  oauthStateHash: string | null;
  orgId: string;
  sessionIdEnc: string | null;
  status: StoredComposioUserConnectionStatus;
  toolkitId: string;
  updatedAt: string;
  userId: string;
}

export interface StoredProfileComposioToolkitRecord {
  allowedActions: string[] | null;
  profileId: string;
  toolkitId: string;
}

export interface LlmUsageStatsDelta {
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
}

/** Bytes one optimiser removed from one tool result before it was inserted. */
export interface ToolOutputSavingsDelta {
  bytesIn: number;
  bytesOut: number;
  optimizer: string;
  tool: string;
}

/** One request's provider tokens, tagged with the arm it belongs to. */
export interface LlmTurnUsageDelta {
  estimated: boolean;
  inputTokens: number;
  optimized: boolean;
  outputTokens: number;
}

export interface StoredLlmTurnUsageRecord {
  arm: string;
  bucket: string;
  estimatedTurns: number;
  inputTokens: number;
  orgId: string;
  outputTokens: number;
  turns: number;
}

export interface StoredToolOutputSavingsRecord {
  /** Day the bytes were removed, `YYYY-MM-DD`. Day resolution because the panel
   * plots days and an hour column would be 24x the rows for a chart nobody asked
   * for at that grain. */
  bucket: string;
  bytesIn: number;
  bytesOut: number;
  calls: number;
  optimizer: string;
  orgId: string;
  tool: string;
  trackedSince: string;
  updatedAt: string;
}

export type McpServerStatus = "connected" | "disconnected" | "error";
export type McpTransport = "http" | "stdio";

export interface CachedMcpTool {
  description: string;
  inputSchema?: unknown;
  name: string;
}

export interface StoredSkillRecord {
  createdAt: string;
  createdBy: SkillCreatedBy;
  description: string;
  disableModelInvocation: boolean;
  enabled: boolean;
  hasTool: boolean;
  id: string;
  name: string;
  orgId?: string | null;
  sourcePath: string;
  updatedAt: string;
}

export type SkillCreatedBy = "agent" | "human" | "bundled";

export interface StoredSkillUsageRecord {
  createdAt: string;
  lastPatchedAt: string | null;
  lastUsedAt: string | null;
  lastViewedAt: string | null;
  orgId: string;
  patchCount: number;
  profileId: string;
  skillId: string;
  updatedAt: string;
  useCount: number;
  viewCount: number;
}

export interface StoredMcpServerRecord {
  cachedTools: CachedMcpTool[];
  config: unknown;
  createdAt: string;
  enabled: boolean;
  id: string;
  lastError: string | null;
  name: string;
  orgId?: string | null;
  status: McpServerStatus;
  transport: McpTransport;
  updatedAt: string;
}

export interface StoredUserRecord {
  createdAt: string;
  email: string;
  id: string;
  isPlatformAdmin?: boolean;
  name?: string | null;
  passwordHash: string;
  phone?: string | null;
  updatedAt: string;
}

export interface StoredOrganizationRecord {
  createdAt: string;
  id: string;
  name: string;
  skillsPostTurnReview?: boolean;
  skillsWriteApproval?: boolean;
  slug: string;
  updatedAt: string;
}

export interface StoredOrgMemberRecord {
  createdAt: string;
  orgId: string;
  role: OrgRole;
  userContext?: string | null;
  userId: string;
}

export interface StoredUserOrganizationRecord {
  joinedAt: string;
  organization: StoredOrganizationRecord;
  role: OrgRole;
}

export interface StoredOrgInviteRecord {
  acceptedAt: string | null;
  createdAt: string;
  email: string;
  expiresAt: string;
  id: string;
  invitedByUserId: string;
  orgId: string;
  revokedAt: string | null;
  role: OrgRole;
  tokenHash: string;
}

export type OrgMemoryProposalStatus = "pending" | "approved" | "rejected";

export interface StoredOrgMemoryProposal {
  bullet: string;
  createdAt: string;
  id: string;
  orgId: string;
  pinned: boolean;
  profileId: string | null;
  proposedByUserId: string | null;
  reviewedAt: string | null;
  reviewerUserId: string | null;
  sessionId: string | null;
  status: OrgMemoryProposalStatus;
}

export type SkillProposalStatus = "pending" | "approved" | "rejected";
export type SkillProposalAction =
  | "create"
  | "patch"
  | "delete"
  | "edit"
  | "write_file"
  | "remove_file";

export interface StoredSkillProposal {
  action: SkillProposalAction;
  content: string | null;
  createdAt: string;
  id: string;
  orgId: string;
  patchNewString: string | null;
  patchOldString: string | null;
  profileId: string;
  proposedByUserId: string | null;
  relativePath: string | null;
  reviewedAt: string | null;
  reviewerUserId: string | null;
  sessionId: string | null;
  skillName: string;
  status: SkillProposalStatus;
}

export type SkillSuggestionStatus = "pending" | "applied";
export type SkillSuggestionAction = "create" | "patch";
export type SkillSuggestionSource = "post_turn_review";

export interface StoredSkillSuggestion {
  action: SkillSuggestionAction;
  appliedAt: string | null;
  content: string | null;
  createdAt: string;
  id: string;
  orgId: string;
  patchNewString: string | null;
  patchOldString: string | null;
  profileId: string;
  proposedByUserId: string | null;
  sessionId: string | null;
  skillName: string;
  source: SkillSuggestionSource;
  status: SkillSuggestionStatus;
  warnings: string[] | null;
}

export interface StoredArtifactShareRecord {
  createdAt: string;
  createdByUserId: string;
  filename: string;
  id: string;
  mimeType: string;
  orgId: string;
  profileId: string;
  revokedAt: string | null;
  sizeBytes: number;
  sourcePath: string;
  storagePath: string;
  tokenHash: string;
}

export interface StoredChannelOrgMappingRecord {
  channel: ChannelType;
  channelUserId: string;
  createdAt: string;
  orgId: string;
  userId: string;
}

export interface StoredBrowserSessionRecord {
  activeOrgId?: string | null;
  createdAt: string;
  csrfTokenHash: string;
  expiresAt: string;
  id: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  sessionTokenHash: string;
  userId: string;
}

export interface DatabaseAdapter {
  appendMessagesForSession(
    sessionId: string,
    messages: StoredSessionMessageRecord[]
  ): Promise<void>;
  assignMcpServerToProfile(profileId: string, serverId: string): Promise<void>;
  assignSkillToProfile(profileId: string, skillId: string): Promise<void>;
  assignToolToProfile(profileId: string, toolId: string): Promise<void>;
  /** Users excluding the auto-created CLI bearer-auth identity. */
  countHumanUsers(): Promise<number>;
  countOrgMemoryProposals(
    orgId: string,
    status: OrgMemoryProposalStatus
  ): Promise<number>;
  countPendingSkillProposals(
    orgId: string,
    profileId?: string
  ): Promise<number>;
  countProfileMcpAssignments(): Promise<number>;
  countUnreadAutomationRunsByOrg(
    userId: string,
    orgId: string
  ): Promise<AutomationUnreadCountRecord[]>;
  countUsers(): Promise<number>;

  createArtifactShare(record: StoredArtifactShareRecord): Promise<void>;

  createBrowserSession(record: StoredBrowserSessionRecord): Promise<void>;

  createOrgInvite(record: StoredOrgInviteRecord): Promise<void>;

  createOrgMemoryProposal(record: StoredOrgMemoryProposal): Promise<void>;

  createSkillProposal(record: StoredSkillProposal): Promise<void>;

  createSkillSuggestion(record: StoredSkillSuggestion): Promise<void>;
  createUser(record: StoredUserRecord): Promise<void>;
  deleteAttachment(id: string): Promise<boolean>;
  deleteAutomation(id: string): Promise<boolean>;
  deleteAutomationRun(automationId: string, runId: string): Promise<boolean>;
  deleteComposioToolkit(id: string): Promise<boolean>;
  deleteComposioUserConnection(id: string): Promise<boolean>;
  deleteMcpServer(id: string): Promise<boolean>;
  deleteMessagesForSession(sessionId: string): Promise<void>;
  deleteNotificationDestination(id: string): Promise<boolean>;
  deleteOrgMember(orgId: string, userId: string): Promise<boolean>;
  deleteProfile(id: string): Promise<boolean>;
  deleteSession(id: string): Promise<boolean>;
  deleteSkill(id: string): Promise<boolean>;
  deleteTask(id: string): Promise<boolean>;
  deleteTool(id: string): Promise<boolean>;
  getActiveArtifactShareByPath(
    orgId: string,
    profileId: string,
    sourcePath: string
  ): Promise<StoredArtifactShareRecord | null>;
  getActiveAutomationRun(
    automationId: string
  ): Promise<StoredAutomationRunRecord | null>;
  getActiveTaskRun(taskId: string): Promise<StoredTaskRunRecord | null>;
  getArtifactShareById(
    orgId: string,
    profileId: string,
    shareId: string
  ): Promise<StoredArtifactShareRecord | null>;
  getArtifactShareByTokenHash(
    tokenHash: string
  ): Promise<StoredArtifactShareRecord | null>;
  getAttachment(id: string): Promise<StoredAttachmentRecord | null>;
  getAutomation(id: string): Promise<StoredAutomationRecord | null>;

  getAutomationRunReadThrough(
    userId: string,
    orgId: string,
    automationId: string
  ): Promise<string | null>;
  getBrowserSessionBySessionTokenHash(
    sessionTokenHash: string
  ): Promise<StoredBrowserSessionRecord | null>;
  getComposioToolkit(id: string): Promise<StoredComposioToolkitRecord | null>;
  getComposioToolkitBySlug(
    orgId: string,
    toolkitSlug: string
  ): Promise<StoredComposioToolkitRecord | null>;
  getComposioUserConnection(
    userId: string,
    toolkitId: string
  ): Promise<StoredComposioUserConnectionRecord | null>;
  getComposioUserConnectionById(
    id: string
  ): Promise<StoredComposioUserConnectionRecord | null>;
  getDefaultProfileForOrg(orgId: string): Promise<StoredProfileRecord | null>;

  getLlmUsageStats(): Promise<StoredLlmUsageStatsRecord | null>;
  getMcpServer(id: string): Promise<StoredMcpServerRecord | null>;
  getMcpServerByName(name: string): Promise<StoredMcpServerRecord | null>;
  getNotificationDestination(
    id: string
  ): Promise<StoredNotificationDestinationRecord | null>;
  getOrganizationById(id: string): Promise<StoredOrganizationRecord | null>;
  getOrganizationBySlug(slug: string): Promise<StoredOrganizationRecord | null>;
  getOrgInviteByTokenHash(
    tokenHash: string
  ): Promise<StoredOrgInviteRecord | null>;
  getOrgMember(
    orgId: string,
    userId: string
  ): Promise<StoredOrgMemberRecord | null>;
  getOrgMemoryProposal(
    orgId: string,
    id: string
  ): Promise<StoredOrgMemoryProposal | null>;
  getPendingOrgInvite(
    orgId: string,
    email: string
  ): Promise<StoredOrgInviteRecord | null>;
  getPendingOrgMemoryProposalByBullet(
    orgId: string,
    bullet: string
  ): Promise<StoredOrgMemoryProposal | null>;
  getPendingSkillProposalForCreate(
    orgId: string,
    profileId: string,
    skillName: string
  ): Promise<StoredSkillProposal | null>;
  getPendingSkillProposalForPatch(
    orgId: string,
    profileId: string,
    skillName: string,
    patchOldString: string,
    patchNewString: string
  ): Promise<StoredSkillProposal | null>;
  getPendingSkillProposalForSkill(
    orgId: string,
    profileId: string,
    skillName: string
  ): Promise<StoredSkillProposal | null>;
  getProfile(id: string): Promise<StoredProfileRecord | null>;
  getProfileForOrg(
    id: string,
    orgId: string
  ): Promise<StoredProfileRecord | null>;
  getSession(id: string): Promise<StoredSessionRecord | null>;
  getSessionQuestionnaire(
    sessionId: string
  ): Promise<AgentQuestionnaire | null>;
  getSessionTodos(sessionId: string): Promise<AgentTodo[]>;
  getSkill(id: string): Promise<StoredSkillRecord | null>;
  getSkillByName(name: string): Promise<StoredSkillRecord | null>;
  getSkillBySourcePath(sourcePath: string): Promise<StoredSkillRecord | null>;
  getSkillProposal(
    orgId: string,
    id: string
  ): Promise<StoredSkillProposal | null>;
  getSkillSuggestion(
    orgId: string,
    id: string
  ): Promise<StoredSkillSuggestion | null>;
  getSkillUsage(
    profileId: string,
    skillId: string
  ): Promise<StoredSkillUsageRecord | null>;
  getTask(id: string): Promise<StoredTaskRecord | null>;
  getTool(id: string): Promise<StoredToolRecord | null>;
  getToolByName(name: string): Promise<StoredToolRecord | null>;
  getUserByEmail(email: string): Promise<StoredUserRecord | null>;
  getUserById(id: string): Promise<StoredUserRecord | null>;
  getUserContext(orgId: string, userId: string): Promise<string | null>;

  getWorkspaceSettings(): Promise<StoredWorkspaceSettingsRecord | null>;
  incrementLlmTurnUsage(orgId: string, delta: LlmTurnUsageDelta): Promise<void>;
  incrementLlmUsageStats(
    delta: LlmUsageStatsDelta,
    trackedSince: string
  ): Promise<void>;
  incrementLlmUsageStatsByModel(
    modelId: string,
    delta: LlmUsageStatsDelta,
    trackedSince: string
  ): Promise<void>;
  incrementSkillUsage(input: {
    orgId: string;
    profileId: string;
    skillId: string;
    viewDelta?: number;
    useDelta?: number;
    patchDelta?: number;
    viewedAt?: string;
    usedAt?: string;
    patchedAt?: string;
  }): Promise<void>;
  incrementToolOutputSavings(
    orgId: string,
    delta: ToolOutputSavingsDelta,
    trackedSince: string
  ): Promise<void>;

  insertAttachment(record: StoredAttachmentRecord): Promise<void>;
  insertAutomationRun(record: StoredAutomationRunRecord): Promise<void>;
  insertTaskRun(record: StoredTaskRunRecord): Promise<void>;

  listAutomationRuns(
    automationId: string,
    limit?: number
  ): Promise<StoredAutomationRunRecord[]>;

  listAutomations(): Promise<StoredAutomationRecord[]>;
  listAutomationsForOrg(orgId: string): Promise<StoredAutomationRecord[]>;

  listComposioToolkitsForOrg(
    orgId: string
  ): Promise<StoredComposioToolkitRecord[]>;

  listComposioUserConnectionsForUser(
    orgId: string,
    userId: string
  ): Promise<StoredComposioUserConnectionRecord[]>;
  listLlmTurnUsage(orgId: string): Promise<StoredLlmTurnUsageRecord[]>;
  listLlmUsageStatsByModel(): Promise<StoredLlmUsageModelStatsRecord[]>;
  listMcpServerProfileCounts(): Promise<Record<string, number>>;

  listMcpServers(): Promise<StoredMcpServerRecord[]>;

  listMcpServersForProfile(profileId: string): Promise<StoredMcpServerRecord[]>;

  listMessagesForSession(
    sessionId: string
  ): Promise<StoredSessionMessageRecord[]>;

  listNotificationDestinationsForOrg(
    orgId: string
  ): Promise<StoredNotificationDestinationRecord[]>;
  listOrganizations(): Promise<StoredOrganizationRecord[]>;
  listOrgMembers(orgId: string): Promise<StoredOrgMemberRecord[]>;
  listOrgMemoryProposals(
    orgId: string,
    status?: OrgMemoryProposalStatus
  ): Promise<StoredOrgMemoryProposal[]>;

  listProfileComposioToolkits(
    profileId: string
  ): Promise<StoredProfileComposioToolkitRecord[]>;

  listProfiles(): Promise<StoredProfileRecord[]>;
  listProfilesForMcpServer(serverId: string): Promise<StoredProfileRecord[]>;
  listProfilesForOrg(orgId: string): Promise<StoredProfileRecord[]>;
  listSessionSummaries(
    profileId: string,
    channel: string
  ): Promise<StoredSessionSummaryRecord[]>;

  listSessions(): Promise<StoredSessionRecord[]>;
  listSkillProposals(
    orgId: string,
    options?: {
      status?: SkillProposalStatus;
      profileId?: string;
      sessionId?: string;
    }
  ): Promise<StoredSkillProposal[]>;
  listSkillSuggestions(
    orgId: string,
    options?: {
      sessionId?: string;
      status?: SkillSuggestionStatus;
      profileId?: string;
    }
  ): Promise<StoredSkillSuggestion[]>;

  listSkills(): Promise<StoredSkillRecord[]>;

  listSkillsForProfile(profileId: string): Promise<StoredSkillRecord[]>;

  listSkillUsageForProfile(
    profileId: string
  ): Promise<StoredSkillUsageRecord[]>;

  listTaskRuns(taskId: string, limit?: number): Promise<StoredTaskRunRecord[]>;

  listTasks(): Promise<StoredTaskRecord[]>;
  listTasksForOrg(orgId: string): Promise<StoredTaskRecord[]>;
  listToolOutputSavings(
    orgId: string
  ): Promise<StoredToolOutputSavingsRecord[]>;

  listTools(): Promise<StoredToolRecord[]>;

  listToolsForProfile(profileId: string): Promise<StoredToolRecord[]>;
  listUserOrganizations(
    userId: string
  ): Promise<StoredUserOrganizationRecord[]>;
  markOrgInviteAccepted(id: string, acceptedAt: string): Promise<void>;
  markSkillSuggestionApplied(
    orgId: string,
    id: string,
    appliedAt: string
  ): Promise<boolean>;
  replaceMessagesForSession(
    sessionId: string,
    messages: StoredSessionMessageRecord[]
  ): Promise<void>;
  replaceProfileComposioToolkits(
    profileId: string,
    assignments: StoredProfileComposioToolkitRecord[]
  ): Promise<void>;
  revokeArtifactShare(id: string, revokedAt: string): Promise<boolean>;
  revokeBrowserSessionBySessionTokenHash(
    sessionTokenHash: string,
    revokedAt: string
  ): Promise<boolean>;
  setUserContext(
    orgId: string,
    userId: string,
    content: string,
    updatedAt: string
  ): Promise<void>;
  unassignMcpServerFromProfile(
    profileId: string,
    serverId: string
  ): Promise<boolean>;
  unassignSkillFromProfile(
    profileId: string,
    skillId: string
  ): Promise<boolean>;
  unassignToolFromProfile(profileId: string, toolId: string): Promise<boolean>;
  updateArtifactShareSnapshot(
    id: string,
    snapshot: Pick<
      StoredArtifactShareRecord,
      "filename" | "mimeType" | "sizeBytes" | "storagePath"
    >
  ): Promise<void>;
  updateAutomationRun(record: StoredAutomationRunRecord): Promise<void>;
  updateBrowserSessionActiveOrgId(
    id: string,
    activeOrgId: string | null
  ): Promise<void>;
  updateBrowserSessionLastUsedAt(id: string, lastUsedAt: string): Promise<void>;
  updateOrgMemoryProposalStatus(
    orgId: string,
    id: string,
    update: {
      status: OrgMemoryProposalStatus;
      reviewerUserId: string;
      reviewedAt: string;
      pinned?: boolean;
    }
  ): Promise<boolean>;
  updateSessionQuestionnaire(
    sessionId: string,
    questionnaire: AgentQuestionnaire | null
  ): Promise<void>;
  updateSessionTitle(sessionId: string, title: string): Promise<boolean>;
  updateSessionTodos(sessionId: string, todos: AgentTodo[]): Promise<void>;
  updateSkillProposalStatus(
    orgId: string,
    id: string,
    update: {
      status: SkillProposalStatus;
      reviewerUserId: string;
      reviewedAt: string;
    }
  ): Promise<boolean>;
  updateTaskRun(record: StoredTaskRunRecord): Promise<void>;
  updateUserPassword(
    id: string,
    passwordHash: string,
    updatedAt: string
  ): Promise<void>;
  updateUserProfile(
    id: string,
    profile: { name: string | null; phone: string | null; email?: string },
    updatedAt: string
  ): Promise<void>;
  upsertAutomation(record: StoredAutomationRecord): Promise<void>;
  upsertAutomationRunReadThrough(
    userId: string,
    orgId: string,
    automationId: string,
    readThroughAt: string
  ): Promise<void>;
  upsertComposioToolkit(record: StoredComposioToolkitRecord): Promise<void>;
  upsertComposioUserConnection(
    record: StoredComposioUserConnectionRecord
  ): Promise<void>;
  upsertMcpServer(record: StoredMcpServerRecord): Promise<void>;
  upsertNotificationDestination(
    record: StoredNotificationDestinationRecord
  ): Promise<void>;

  upsertOrganization(record: StoredOrganizationRecord): Promise<void>;
  upsertOrgMember(record: StoredOrgMemberRecord): Promise<void>;
  upsertProfile(record: StoredProfileRecord): Promise<void>;
  upsertSession(record: StoredSessionRecord): Promise<void>;
  upsertSkill(record: StoredSkillRecord): Promise<void>;
  upsertTask(record: StoredTaskRecord): Promise<void>;
  upsertTool(record: StoredToolRecord): Promise<void>;
  upsertWorkspaceSettings(record: StoredWorkspaceSettingsRecord): Promise<void>;
}
