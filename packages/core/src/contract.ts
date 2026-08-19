import type { LoadAttachmentBytes } from "./attachments/content";

export type AutomationTrigger =
  | { type: "manual" }
  | { type: "schedule"; cron: string; timezone?: string }
  | { type: "runAt"; at: string; timezone?: string };

export interface AutomationStep {
  id: string;
  input: Record<string, unknown>;
  tool: string;
}

export type AutomationDeliveryChannel =
  | "telegram"
  | "whatsapp"
  | "email"
  | "discord";

export type AutomationDeliveryNotifyOn = "success" | "failure" | "both";

export interface AutomationDelivery {
  channel: AutomationDeliveryChannel;
  /** Optional Discord channel snowflake; defaults to DMs for all paired users. */
  channelId?: string;
  /** Optional Telegram chat override; defaults to all paired users. */
  chatId?: number;
  notifyOn?: AutomationDeliveryNotifyOn;
  /** Required when channel is email. */
  to?: string;
}

export interface AutomationDefinition {
  delivery?: AutomationDelivery;
  description: string;
  id: string;
  name: string;
  prompt: string;
  steps: AutomationStep[];
  trigger: AutomationTrigger;
  version: number;
}

export interface StoredAutomation extends AutomationDefinition {
  createdAt: string;
  enabled: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  orgId?: string | null;
  profileId: string;
  updatedAt: string;
}

export type AutomationRunStatus = "running" | "completed" | "failed";

export type AutomationDeliveryStatus = "sent" | "failed" | "skipped";

export interface AutomationRunRecord {
  automationId: string;
  completedAt: string | null;
  deliveryError?: string | null;
  deliveryStatus?: AutomationDeliveryStatus | null;
  error: string | null;
  id: string;
  output: string | null;
  /** Present when the API resolves read state for the current user. */
  read?: boolean;
  startedAt: string;
  status: AutomationRunStatus;
}

export interface AutomationUnreadSummary {
  byAutomationId: Record<string, number>;
  totalUnread: number;
}

export type AgentChannel =
  | "web"
  | "cli"
  | "telegram"
  | "whatsapp"
  | "discord"
  | "automation"
  | "task"
  | "subagent";

export const NAKAMA_API_VERSION = 1;

export interface HealthResponse {
  apiVersion: typeof NAKAMA_API_VERSION;
  /**
   * Whether Nakama can reach the Composio API with the saved key.
   * Probed only on `GET /v1/system/status` (`server.composioAvailable`).
   * `GET /health` always returns `false` so liveness stays local and fast.
   */
  composioAvailable: boolean;
  /** A Composio project API key is saved on this server. */
  composioConfigured: boolean;
  ok: true;
  providerConfigured: boolean;
  userConfigured: boolean;
}

export interface AutomationSchedule {
  /** Recurring cron trigger — mutually exclusive with runAt. */
  cron?: string;
  id: string;
  orgId: string;
  profileId: string;
  /** One-shot ISO-8601 datetime — mutually exclusive with cron. */
  runAt?: string;
  timezone: string | null;
}

export interface AutomationWorkerStatus {
  activeRuns: number;
  ok: boolean;
  process?: WorkerProcessInfo;
  providerConfigured: boolean;
  running: boolean;
  scheduledJobs: number;
}

export interface TaskWorkerStatus {
  activeRuns: number;
  ok: boolean;
  providerConfigured: boolean;
}

export interface WorkerProcessInfo {
  cpuPercent: number | null;
  managed: boolean;
  memoryMb: number | null;
  status: "online" | "stopped" | "errored" | null;
  uptimeSeconds: number | null;
}

export interface TelegramWorkerStatus {
  configured: boolean;
  ok: boolean;
  paired: boolean;
  process?: WorkerProcessInfo;
  running: boolean;
}

export interface DiscordWorkerStatus {
  configured: boolean;
  connected: boolean;
  ok: boolean;
  paired: boolean;
  process?: WorkerProcessInfo;
  running: boolean;
}

export interface WhatsAppWorkerStatus {
  configured: boolean;
  connected: boolean;
  ok: boolean;
  paired: boolean;
  process?: WorkerProcessInfo;
  qrCode: string | null;
  running: boolean;
}

export interface WorkerLogsResponse {
  stderr: string;
  stdout: string;
}

export interface LlmUsageStats {
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  totalTokens: number;
  trackedSince: string;
}

export interface LlmUsageModelStats extends LlmUsageStats {
  modelId: string;
}

export interface LlmUsageStatus extends LlmUsageStats {
  costEstimated: boolean;
  currentModel: string | null;
  displayName: string | null;
  models: LlmUsageModelStats[];
  provider: ProviderName | null;
  providerConfigured: boolean;
}

export interface McpStatus {
  assignedProfileCount: number;
  connectedCount: number;
  serverCount: number;
}

/**
 * Bytes an optimiser removed from tool results before they entered the
 * conversation. Not tokens and not cost: see the route that serves it for why
 * converting these to either would be a fabrication.
 */
export interface TokenOptimizationResponse {
  /**
   * Two arms. `optimized` is what an optimiser shortened; `control` is what went
   * in untouched. One arm alone is not a comparison, it is a restatement that
   * the feature was on.
   */
  arms: {
    control: TokenOptimizationArm;
    optimized: TokenOptimizationArm;
  };
  byTool: Array<{
    bytesIn: number;
    bytesOut: number;
    calls: number;
    tool: string;
  }>;
  /** One entry per day in the window, oldest first, zero-filled. */
  days: Array<{
    bytesIn: number;
    bytesRemoved: number;
    day: string;
  }>;
  /**
   * Provider input tokens per turn, split by arm. The only tokens here; every
   * other figure is bytes. Observational rather than randomised, so a workload
   * difference between the arms is a confound, not a result.
   */
  inputTokens: {
    control: TokenOptimizationTurnArm;
    optimized: TokenOptimizationTurnArm;
  };
  optimizers: Array<{
    enabled: boolean;
    id: string;
    /** Whether the binary is reachable on this host. Enabled without installed
     * is the case an operator has to be told about, because the optimiser fails
     * open and would otherwise look merely idle. */
    installed: boolean;
    tools: string[];
  }>;
  totals: {
    bytesIn: number;
    bytesRemoved: number;
    calls: number;
  };
  trackedSince: string | null;
  windowDays: number;
}

export interface TokenOptimizationUpdateResponse {
  enabled: boolean;
  /**
   * Why the binary is still missing after switching the optimiser on, or null.
   * Switching on triggers an install, and an operator who is told only that the
   * binary is absent cannot tell a blocked download from one never attempted.
   */
  installError: string | null;
  installed: boolean;
}

export interface CodingHarnessLoginCommand {
  command: string;
  name: string;
}

export interface CodingHarnessSettingsResponse {
  loginCommands: CodingHarnessLoginCommand[];
  providerPassthroughEnabled: boolean;
}

export interface UpdateCodingHarnessSettingsRequest {
  providerPassthroughEnabled: boolean;
}

export interface TokenOptimizationTurnArm {
  arm: string;
  /** Turns whose token count came from an estimate, not the provider. */
  estimatedTurns: number;
  inputTokens: number;
  inputTokensPerTurn: number;
  turns: number;
}

export interface TokenOptimizationArm {
  arm: string;
  bytesIn: number;
  bytesOut: number;
  calls: number;
}

export interface SystemStatusResponse {
  automationWorker: AutomationWorkerStatus;
  checkedAt: string;
  discordWorker: DiscordWorkerStatus;
  llmUsage: LlmUsageStatus;
  mcp: McpStatus;
  server: HealthResponse;
  taskWorker: TaskWorkerStatus;
  telegramWorker: TelegramWorkerStatus;
  whatsappWorker: WhatsAppWorkerStatus;
}

export interface DataExportSkippedItem {
  path: string;
  reason: string;
}

export interface DataExportManifest {
  apiVersion: typeof NAKAMA_API_VERSION;
  createdAt: string;
  fileCount: number;
  kind: "nakama-export";
  skipped: DataExportSkippedItem[];
  sourceRootName: string;
  topLevelPaths: string[];
  totalBytes: number;
  version: number;
}

export interface DataImportPreviewResponse {
  archiveFileCount: number;
  archiveTotalBytes: number;
  manifest: DataExportManifest;
  topLevelPaths: string[];
  willReplaceRoot: boolean;
}

export interface RestoreDataImportRequest {
  confirm: boolean;
  data: string;
}

export interface PreviewDataImportRequest {
  data: string;
}

export interface RestoreDataImportResponse {
  manifest: DataExportManifest;
  restoredFileCount: number;
  restoredRoot: string;
}

export interface SetupRestoreDataImportResponse
  extends RestoreDataImportResponse {
  requiresRestart: boolean;
}

export interface AuthCredentialsRequest {
  email: string;
  password: string;
}

export interface SetupAuthRequest {
  admin: {
    name: string;
    email: string;
    phone?: string;
    password: string;
  };
  organization: {
    name: string;
    slug: string;
  };
  /** Public web app origin (e.g. window.location.origin) for OAuth callbacks. */
  webPublicUrl?: string;
}

export interface UpdateWebPublicUrlRequest {
  webPublicUrl: string;
}

export interface WebPublicUrlSettingsResponse {
  /** Set when NAKAMA_WEB_PUBLIC_URL / NAKAMA_PUBLIC_URL overrides the saved value. */
  envOverride: string | null;
  webPublicUrl: string | null;
}

export interface AuthUserResponse {
  activeOrgId?: string | null;
  email: string;
  isPlatformAdmin?: boolean;
  name?: string | null;
  orgId?: string | null;
  phone?: string | null;
}

export interface UpdateAuthProfileRequest {
  email?: string;
  name?: string | null;
  phone?: string | null;
}

export type OrgRole = "admin" | "member" | "viewer";
export type ChannelType = "telegram" | "whatsapp" | "discord";

export interface OrganizationSummary {
  createdAt: string;
  id: string;
  name: string;
  skillsPostTurnReview?: boolean;
  skillsWriteApproval?: boolean;
  slug: string;
  updatedAt: string;
}

export interface CreateOrganizationRequest {
  admin?: {
    name: string;
    email: string;
    phone: string;
  };
  name: string;
  slug: string;
}

export interface UpdateOrganizationRequest {
  name?: string;
  skillsPostTurnReview?: boolean;
  skillsWriteApproval?: boolean;
}

export interface ListOrganizationsResponse {
  organizations: OrganizationSummary[];
}

export interface OrganizationResponse {
  organization: OrganizationSummary;
}

export interface OrgInviteCreatedResponse {
  invite: OrgInviteSummary;
  token: string;
}

export interface AddOrgMemberResponse {
  member: OrgMemberSummary;
  temporaryPassword: string | null;
}

export interface CreateOrganizationResponse {
  adminMember?: AddOrgMemberResponse;
  organization: OrganizationSummary;
}

export interface UserOrgSummary extends OrganizationSummary {
  role: OrgRole;
}

export interface ListUserOrgsResponse {
  orgs: UserOrgSummary[];
}

export interface SetActiveOrgRequest {
  orgId: string;
}

export interface OrgMemberSummary {
  createdAt: string;
  email: string;
  name: string | null;
  phone: string | null;
  role: OrgRole;
  userId: string;
}

export interface ListOrgMembersResponse {
  members: OrgMemberSummary[];
}

export interface AddOrgMemberRequest {
  email: string;
  name: string;
  phone?: string;
  role: OrgRole;
}

export interface OrgMemberResponse {
  member: OrgMemberSummary;
}

export interface UpdateOrgMemberRequest {
  name?: string | null;
  phone?: string | null;
  role?: OrgRole;
}

export interface OrgMemoryResponse {
  content: string;
}

export interface UpdateOrgMemoryRequest {
  content: string;
}

export interface AddOrgMemoryFactRequest {
  bullet: string;
  pin?: boolean;
}

export interface OrgMemorySearchRequest {
  query: string;
}

export interface OrgMemorySearchMatchEntry {
  bullet: string;
  date?: string;
  source: string;
  tier?: "pinned" | "recent-log" | "archive";
}

export interface OrgMemorySearchResponse {
  matches: OrgMemorySearchMatchEntry[];
  query: string;
}

export interface ArchiveOrgMemoryRequest {
  entries: string[];
  reason?: string;
}

export interface ArchiveOrgMemoryResponse {
  activeBytes: number;
  archived: number;
  archivePath: string;
}

export interface PinOrgMemoryRequest {
  bullet: string;
}

export interface UnpinOrgMemoryRequest {
  bullet: string;
}

export type OrgMemoryChangeAction =
  | "edit"
  | "approve"
  | "add_fact"
  | "pin"
  | "unpin"
  | "archive"
  | "restore";

export interface OrgMemoryChangeLogEntry {
  action: OrgMemoryChangeAction;
  actorUserId: string | null;
  createdAt: string;
  id: string;
  label: string;
  orgId: string;
  restoredFromId?: string | null;
}

export interface ListOrgMemoryHistoryResponse {
  changes: OrgMemoryChangeLogEntry[];
}

export interface RestoreOrgMemoryHistoryResponse {
  content: string;
}

export interface OrgMemoryHistoryRevisionResponse {
  change: OrgMemoryChangeLogEntry;
  content: string;
}

export type OrgMemoryProposalStatus = "pending" | "approved" | "rejected";

export interface OrgMemoryProposal {
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

export interface ListOrgMemoryProposalsResponse {
  pendingCount: number;
  proposals: OrgMemoryProposal[];
}

export interface ApproveOrgMemoryProposalRequest {
  pin?: boolean;
}

export interface OrgMemoryProposalResponse {
  content?: string;
  proposal: OrgMemoryProposal;
}

export type SkillProposalStatus = "pending" | "approved" | "rejected";
export type SkillProposalAction =
  | "create"
  | "patch"
  | "delete"
  | "edit"
  | "write_file"
  | "remove_file";

export interface SkillProposal {
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
  warnings?: string[];
}

export interface ListSkillProposalsResponse {
  pendingCount: number;
  proposals: SkillProposal[];
}

export interface SkillProposalResponse {
  proposal: SkillProposal;
}

export type SkillSuggestionStatus = "pending" | "applied";
export type SkillSuggestionAction = "create" | "patch";
export type SkillSuggestionSource = "post_turn_review";

export interface SkillSuggestion {
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
  warnings?: string[];
}

export interface ListSkillSuggestionsResponse {
  suggestions: SkillSuggestion[];
}

export type ApplySkillSuggestionOutcome =
  | "applied"
  | "already_applied"
  | "staged_as_proposal";

export interface ApplySkillSuggestionResponse {
  outcome: ApplySkillSuggestionOutcome;
  proposalId?: string;
  suggestion: SkillSuggestion;
}

export interface InviteOrgMemberRequest {
  email: string;
  role: OrgRole;
}

export interface OrgInviteSummary {
  createdAt: string;
  email: string;
  expiresAt: string;
  id: string;
  orgId: string;
  role: OrgRole;
}

export interface AcceptOrgInviteRequest {
  password?: string;
  token: string;
}

export interface AcceptOrgInviteResponse {
  email: string;
  orgId: string;
  role: OrgRole;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ChannelOrgMappingSummary {
  channel: ChannelType;
  channelUserId: string;
  createdAt: string;
  orgId: string;
  userId: string;
}

export interface CreateChannelOrgMappingRequest {
  channel: ChannelType;
  channelUserId: string;
  userId: string;
}

export interface ListChannelOrgMappingsResponse {
  mappings: ChannelOrgMappingSummary[];
}

export interface CreateSessionRequest {
  channel: AgentChannel;
  profileId?: string;
}

export interface CreateSessionResponse {
  sessionId: string;
}

export interface BranchSessionRequest {
  messageIndex: number;
}

export interface BranchSessionResponse {
  sessionId: string;
}

export type AgentTodoStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface AgentTodo {
  content: string;
  id: string;
  status: AgentTodoStatus;
}

export interface AgentQuestionChoice {
  id: string;
  label: string;
}

export interface AgentQuestionItem {
  allowCustomAnswer: boolean;
  choices: AgentQuestionChoice[];
  id: string;
  placeholder?: string;
  prompt: string;
}

export interface AgentQuestionnaire {
  id: string;
  questions: AgentQuestionItem[];
  title: string;
}

export interface AgentQuestionAnswer {
  answer: string;
  prompt: string;
  questionId: string;
}

export interface SessionMessageMeta {
  createdAt: string;
  id: string;
  seq: number;
}

/** How full the model context window is for the current chat session. */
export type ChatContextUsageSource = "provider" | "estimate";

export interface ChatContextUsage {
  /**
   * Bytes an optimiser kept out of this session's context so far. Absent until
   * something is actually removed, so the UI reports a measurement rather than
   * announcing a feature. Bytes, not tokens: the label must carry a byte unit.
   */
  bytesKeptOut?: number;
  /** Everything the handled tools produced this session, the denominator for
   * the percentage. Present whenever bytesKeptOut is. */
  bytesProduced?: number;
  contextWindow: number;
  source: ChatContextUsageSource;
  /** Denominator matching compaction usable context (window minus reserved output). */
  usableContextTokens: number;
  usedTokens: number;
}

export interface SessionMessagesResponse {
  channel: AgentChannel;
  contextUsage?: ChatContextUsage | null;
  messageMeta: SessionMessageMeta[];
  messages: ChatMessage[];
  questionnaire: AgentQuestionnaire | null;
  todos: AgentTodo[];
}

export interface SessionStatusResponse {
  active: boolean;
  startedAt?: string;
}

export interface SessionSummary {
  channel: AgentChannel;
  createdAt: string;
  id: string;
  messageCount: number;
  preview: string | null;
  profileId: string;
  title: string | null;
  updatedAt: string;
}

export interface ListSessionsResponse {
  sessions: SessionSummary[];
}

export interface CompactSessionRequest {
  force?: boolean;
}

export interface CompactionResponse {
  action: "none" | "pruned" | "summarized";
  messagesAfter: number;
  messagesBefore: number;
  prunedTokens?: number;
}

export type MessageContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string; description?: string }
  | { type: "document"; filename: string; mediaType: string; data: string }
  | { type: "image_ref"; attachmentId: string; mediaType: string; size: number }
  | {
      type: "document_ref";
      attachmentId: string;
      filename: string;
      mediaType: string;
      size: number;
    };

export interface ImageAttachment {
  data: string;
  mediaType: string;
}

export interface DocumentAttachment {
  data: string;
  filename: string;
  mediaType: string;
}

export interface SendMessageInput {
  /** Browser origin for OAuth callbacks (e.g. window.location.origin). */
  clientOrigin?: string;
  documents?: DocumentAttachment[];
  images?: ImageAttachment[];
  message: string;
}

export interface SendMessageRequest {
  clientOrigin?: string;
  documents?: DocumentAttachment[];
  images?: ImageAttachment[];
  message: string;
  stream?: boolean;
}

export interface SendMessageResponse {
  contextUsage?: ChatContextUsage;
  reply: string;
}

export type StreamEvent =
  | { type: "chunk"; delta: string }
  | { type: "thinking"; delta: string }
  | {
      type: "tool_input_delta";
      toolCallId: string;
      tool: string;
      delta: string;
      accumulatedArguments?: string;
    }
  | {
      type: "tool_start";
      toolCallId: string;
      tool: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_end";
      toolCallId: string;
      tool: string;
      result: unknown;
    }
  | { type: "todos_updated"; todos: AgentTodo[] }
  | { type: "questionnaire_updated"; questionnaire: AgentQuestionnaire | null }
  | {
      type: "sub_agent_activity";
      parentToolCallId: string;
      label: string;
    }
  | { type: "done"; reply: string; contextUsage?: ChatContextUsage }
  | { type: "error"; error: string };

export interface DraftAutomationRequest {
  channel: AgentChannel;
  prompt: string;
}

export interface DraftAutomationResponse {
  automation: AutomationDefinition;
}

export interface ListAutomationsResponse {
  automations: StoredAutomation[];
  unread?: AutomationUnreadSummary;
}

export interface AutomationResponse {
  automation: StoredAutomation;
}

export interface CreateAutomationRequest {
  delivery?: AutomationDelivery;
  description: string;
  enabled?: boolean;
  name: string;
  profileId?: string;
  prompt: string;
  trigger: AutomationTrigger;
}

export interface UpdateAutomationRequest {
  delivery?: AutomationDelivery | null;
  description?: string;
  enabled?: boolean;
  name?: string;
  prompt?: string;
  trigger?: AutomationTrigger;
}

export interface RunAutomationResponse {
  run: AutomationRunRecord;
}

export interface ListAutomationRunsResponse {
  runs: AutomationRunRecord[];
}

export interface MarkAutomationRunsReadResponse {
  readThroughAt: string;
}

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "done",
  "failed",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface StoredTask {
  createdAt: string;
  description: string;
  id: string;
  position: number;
  profileId: string;
  prompt: string;
  sessionId: string | null;
  status: TaskStatus;
  title: string;
  updatedAt: string;
}

export interface DraftTaskPromptRequest {
  description?: string;
  title: string;
}

export interface DraftTaskPromptResponse {
  prompt: string;
}

export interface CreateTaskRequest {
  description?: string;
  profileId?: string;
  prompt: string;
  status?: TaskStatus;
  title: string;
}

export interface UpdateTaskRequest {
  description?: string;
  position?: number;
  profileId?: string;
  prompt?: string;
  status?: TaskStatus;
  title?: string;
}

export interface ListTasksResponse {
  tasks: StoredTask[];
}

export interface TaskResponse {
  task: StoredTask;
}

export type TaskRunStatus = "running" | "completed" | "failed";

export interface TaskRunRecord {
  completedAt: string | null;
  error: string | null;
  id: string;
  output: string | null;
  startedAt: string;
  status: TaskRunStatus;
  taskId: string;
}

export interface RunTaskResponse {
  run: TaskRunRecord;
}

export interface ListTaskRunsResponse {
  runs: TaskRunRecord[];
}

export interface TaskMessagesResponse {
  messages: ChatMessage[];
  sessionId: string;
}

export interface TimezoneSettingsResponse {
  timezone: string;
}

export interface UpdateTimezoneRequest {
  timezone: string;
}

export type ThinkingEffort = "low" | "medium" | "high";

export interface ThinkingSettings {
  effort: ThinkingEffort;
  enabled: boolean;
}

export interface ThinkingSettingsResponse {
  thinking: ThinkingSettings;
}

export interface UpdateThinkingRequest {
  effort?: ThinkingEffort;
  enabled: boolean;
}

export interface VisionSettings {
  model: string | null;
}

export interface VisionSettingsResponse {
  vision: VisionSettings;
}

export interface UpdateVisionRequest {
  model: string | null;
}

export interface TranscriptionSettings {
  model: string | null;
}

export interface TranscriptionSettingsResponse {
  transcription: TranscriptionSettings;
}

export interface UpdateTranscriptionRequest {
  model: string | null;
}

export interface TranscribeAudioRequest {
  data: string;
  filename?: string;
  mediaType: string;
}

export interface TranscribeAudioResponse {
  text: string;
}

export interface ImageGenerationSettings {
  model: string | null;
}

export interface ImageGenerationSettingsResponse {
  imageGeneration: ImageGenerationSettings;
}

export interface UpdateImageGenerationRequest {
  model: string | null;
}

export interface GenerateImageRequest {
  prompt: string;
  size?: string;
}

export interface GenerateImageResponse {
  data: string;
  mediaType: string;
  model: string;
  revisedPrompt?: string;
  size: string;
  sizeBytes: number;
}

export interface RotateLocalAuthTokenResponse {
  token: string;
}

export interface TelegramSettingsResponse {
  allowedUserIds: number[];
  botTokenMasked: string | null;
  configured: boolean;
  handshakeCode: string | null;
  pairedUserIds: number[];
  profileId: string;
}

export interface UpdateTelegramSettingsRequest {
  allowedUserIds?: string;
  botToken?: string;
  profileId?: string;
}

export interface DiscordSettingsResponse {
  allowedUserIds: string[];
  botTokenMasked: string | null;
  configured: boolean;
  handshakeCode: string | null;
  inviteUrl: string | null;
  pairedUserIds: string[];
  profileId: string;
}

export interface UpdateDiscordSettingsRequest {
  allowedUserIds?: string;
  botToken?: string;
  profileId?: string;
}

export interface ComposioSettingsResponse {
  apiKeyMasked: string | null;
  composioReachable: boolean;
  configured: boolean;
}

export interface UpdateComposioSettingsRequest {
  apiKey?: string;
}

export type NotificationDestinationChannel = "telegram";

export type NotificationWebhookLevel = "info" | "success" | "warning" | "error";

export interface TelegramNotificationDestinationConfig {
  chatId: number;
  topicId?: number | null;
}

export interface NotificationDestinationSummary {
  channel: NotificationDestinationChannel;
  createdAt: string;
  id: string;
  name: string;
  telegram: TelegramNotificationDestinationConfig;
  updatedAt: string;
  webhookPath: string;
}

export interface NotificationDestinationWithSecret {
  apiKey: string;
  destination: NotificationDestinationSummary;
}

export interface ListNotificationDestinationsResponse {
  destinations: NotificationDestinationSummary[];
}

export interface CreateNotificationDestinationRequest {
  channel: NotificationDestinationChannel;
  name: string;
  telegram: TelegramNotificationDestinationConfig;
}

export interface UpdateNotificationDestinationRequest {
  name: string;
  telegram: TelegramNotificationDestinationConfig;
}

export interface RegenerateNotificationDestinationKeyResponse {
  apiKey: string;
  destination: NotificationDestinationSummary;
}

export interface NotificationWebhookRequest {
  body: string;
  level?: NotificationWebhookLevel;
  title?: string;
}

export interface EmailSettingsResponse {
  configured: boolean;
  from: string | null;
  fromName: string | null;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean | null;
  passwordMasked: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  username: string | null;
}

export interface UpdateEmailSettingsRequest {
  from?: string;
  fromName?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  password?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  username?: string;
}

export interface SendEmailTestRequest {
  to?: string;
}

export interface SendEmailTestResponse {
  messageId: string;
  ok: true;
  to: string;
}

export type CodingAgentProviderPassthroughSummary = {
  active: boolean;
  configured: boolean;
  compatible: boolean;
  providerLabel: string | null;
  model: string | null;
  message?: string | null;
};

export interface AgentBrowserStatusResponse {
  installCommand: string;
  installed: boolean;
  nextStep: "install" | null;
  ready: boolean;
  statusMessage: string | null;
  version: string | null;
}

export type AgentBrowserInstallEvent =
  | {
      type: "progress";
      message: string;
    }
  | {
      type: "done";
      status: AgentBrowserStatusResponse;
    }
  | {
      type: "error";
      error: string;
    };

export interface WhatsAppSettingsResponse {
  configured: boolean;
  pairedJid: string | null;
  pairingCode: string | null;
  phoneNumberMasked: string | null;
  profileId: string;
}

export interface UpdateWhatsAppSettingsRequest {
  phoneNumber?: string;
  profileId?: string;
}

export interface TimezoneCatalogEntry {
  abbreviation: string;
  /** Extra searchable city names (e.g. San Francisco → America/Los_Angeles). */
  aliases?: string[];
  city: string;
  countryCode: string;
  countryName: string;
  id: string;
  label: string;
  offset: string;
  tzName: string;
}

export interface TimezoneCatalogGroup {
  countryCode: string;
  countryName: string;
  timezones: TimezoneCatalogEntry[];
}

export interface ListTimezonesResponse {
  groups: TimezoneCatalogGroup[];
}

export interface ProfileRef {
  id: string;
  name: string;
}

export interface ApiErrorResponse {
  error: string;
  profiles?: ProfileRef[];
}

export interface CustomModelEntry {
  default?: boolean;
  id: string;
  inputPerMillionUsd?: number;
  name?: string;
  outputPerMillionUsd?: number;
  supportsThinking?: boolean;
  supportsVision?: boolean;
}

export interface ProviderModelOption {
  contextWindow?: number;
  default?: boolean;
  id: string;
  inputPerMillionUsd?: number;
  maxOutputTokens?: number;
  name: string;
  outputPerMillionUsd?: number;
  provider: ProviderName;
  providerId?: string;
  providerLabel?: string;
  supportsThinking?: boolean;
  supportsVision?: boolean;
}

export interface ProviderInstanceSummary {
  baseUrl?: string | null;
  createdAt: string;
  customModels?: CustomModelEntry[];
  hasApiKey: boolean;
  hostMode?: OllamaHostMode | null;
  id: string;
  label: string;
  modelCount: number;
  type: ProviderName;
}

export interface ListProvidersResponse {
  defaultProviderId: string | null;
  providers: ProviderInstanceSummary[];
}

export interface CreateProviderRequest {
  apiKey: string;
  baseUrl?: string;
  customModels?: CustomModelEntry[];
  hostMode?: OllamaHostMode;
  label?: string;
  model?: string;
  type: ProviderName;
}

export interface CreateProviderResponse {
  defaultProviderId: string;
  initialModel: string;
  provider: ProviderInstanceSummary;
}

export interface UpdateProviderRequest {
  apiKey?: string;
  baseUrl?: string;
  customModels?: CustomModelEntry[];
  hostMode?: OllamaHostMode;
  label?: string;
}

export interface UpdateProviderResponse {
  provider: ProviderInstanceSummary;
}

export interface DeleteProviderResponse {
  defaultProviderId: string | null;
}

export interface ModelsResponse {
  baseUrl?: string | null;
  /** Full static model catalog for provider setup and management UIs. */
  catalog?: ProviderModelOption[];
  currentProviderId: string | null;
  customModels?: CustomModelEntry[];
  displayName: string | null;
  models: ProviderModelOption[];
  provider: ProviderName | null;
  providers: ProviderInstanceSummary[];
}

export interface DiscoverModelsRequest {
  apiKey?: string;
  baseUrl?: string;
  hostMode?: OllamaHostMode;
  /** When set, discovery uses the matching remote fetch path (Ollama includes `/api/tags` fallback). */
  provider?: "ollama" | "openai_compatible" | "fireworks";
  providerId?: string;
}

export interface ConfigureProviderRequest {
  apiKey: string;
  baseUrl?: string;
  customModels?: CustomModelEntry[];
  displayName?: string;
  hostMode?: OllamaHostMode;
  model?: string;
  provider: ProviderName;
}

export interface ConfigureProviderResponse {
  currentModel: string;
  displayName: string | null;
  provider: ProviderName;
}

export interface ProfileSummary {
  createdAt: string;
  hasAvatar: boolean;
  id: string;
  isDefault?: boolean;
  isSuper: boolean;
  mcpServerCount: number;
  model: string | null;
  name: string;
  /** null = inherit org default; true/false = force post-turn review on/off for this profile */
  skillsPostTurnReview?: boolean | null;
  /** null = inherit org default; true/false = force gate on/off for this profile */
  skillsWriteApproval?: boolean | null;
  soulActive: boolean;
  toolCount: number;
  updatedAt: string;
}

export interface ProfileDetail extends ProfileSummary {
  mcpServers: McpServerSummary[];
  skills: SkillSummary[];
  systemPrompt: string;
  tools: ToolSummary[];
}

export interface SkillUsageSummary {
  lastPatchedAt: string | null;
  lastUsedAt: string | null;
  lastViewedAt: string | null;
  patchCount: number;
  useCount: number;
  viewCount: number;
}

export type SkillCreatedBy = "agent" | "human" | "bundled";

export interface SkillSummary {
  createdAt: string;
  createdBy: SkillCreatedBy;
  description: string;
  disableModelInvocation: boolean;
  enabled: boolean;
  hasTool: boolean;
  id: string;
  name: string;
  sourcePath: string;
  updatedAt: string;
  usage?: SkillUsageSummary;
}

export interface SkillDetail extends SkillSummary {
  body: string;
}

export interface ListSkillsResponse {
  skills: SkillSummary[];
}

export interface SkillResponse {
  skill: SkillDetail;
}

export interface AssignSkillRequest {
  skillId: string;
}

export interface CloneProfileRequest {
  /** Optional explicit id; otherwise a unique slug of the name. */
  id?: string;
  /** Defaults to `{source name} (copy)`. */
  name?: string;
}

export interface CreateSkillRequest {
  body?: string;
  description: string;
  disableModelInvocation?: boolean;
  name: string;
  profileId?: string;
}

export interface InstallSkillRequest {
  profileId: string;
  url: string;
}

export interface PatchSkillRequest {
  body?: string;
  description?: string;
  disableModelInvocation?: boolean;
}

export interface SyncSkillsResponse {
  created: number;
  discovered: number;
  updated: number;
}

export type McpServerStatus = "connected" | "disconnected" | "error";
export type McpTransport = "http" | "stdio";

export interface McpHttpConfig {
  headers?: Record<string, string>;
  url: string;
}

export interface McpStdioConfig {
  args?: string[];
  command: string;
  env?: Record<string, string>;
}

export type McpServerConfig = McpHttpConfig | McpStdioConfig;

export interface CachedMcpToolSummary {
  description: string;
  inputSchema?: unknown;
  name: string;
}

export interface McpServerSummary {
  assignedProfileCount?: number;
  createdAt: string;
  enabled: boolean;
  id: string;
  lastError: string | null;
  name: string;
  status: McpServerStatus;
  toolCount: number;
  transport: McpTransport;
  updatedAt: string;
}

export interface McpServerDetail extends McpServerSummary {
  cachedTools: CachedMcpToolSummary[];
  config: McpServerConfig;
}

export interface ListMcpServersResponse {
  servers: McpServerSummary[];
}

export interface McpServerResponse {
  server: McpServerDetail;
}

export interface CreateMcpServerRequest {
  config: McpServerConfig;
  connect?: boolean;
  enabled?: boolean;
  name: string;
  /** When testing an existing server, merges blank header/env values with stored secrets. */
  serverId?: string;
  transport: McpTransport;
}

export interface UpdateMcpServerRequest {
  config?: McpServerConfig;
  enabled?: boolean;
  name?: string;
  transport?: McpTransport;
}

export interface AssignMcpServerRequest {
  serverId: string;
}

export interface TestMcpServerResponse {
  error?: string;
  ok: boolean;
  toolCount: number;
  tools: CachedMcpToolSummary[];
}

export interface ToolSummary {
  description: string;
  handlerType: string;
  id: string;
  name: string;
}

export interface ToolDetail extends ToolSummary {
  createdAt: string;
  handlerConfig: unknown;
  /** Resolved JSON Schema for javascript tools (module export or handlerConfig). */
  parameters?: JsonSchema;
  updatedAt: string;
}

export interface ToolResponse {
  tool: ToolDetail;
}

export interface ToolSourceResponse {
  content: string;
  language: "javascript" | "typescript";
  path: string;
}

export interface ListProfilesResponse {
  profiles: ProfileSummary[];
}

export interface ProfileResponse {
  profile: ProfileDetail;
}

export interface CreateProfileRequest {
  id?: string;
  isSuper?: boolean;
  model?: string | null;
  name: string;
  soulFiles?: {
    "SOUL.md"?: string;
    "STYLE.md"?: string;
    "INSTRUCTIONS.md"?: string;
    "MEMORY.md"?: string;
  };
  systemPrompt?: string;
}

export interface UpdateProfileRequest {
  model?: string | null;
  name?: string;
  skillsPostTurnReview?: boolean | null;
  skillsWriteApproval?: boolean | null;
  systemPrompt?: string;
}

export interface CreateToolRequest {
  description: string;
  handlerConfig?: unknown;
  handlerType?: string;
  name: string;
}

export interface ListToolsResponse {
  tools: ToolDetail[];
}

export interface AssignToolRequest {
  toolId: string;
}

export interface RunToolRequest {
  parameters: Record<string, unknown>;
}

export interface RunToolResponse {
  error?: string;
  ok: boolean;
  result?: unknown;
}

export interface SuggestToolParamsRequest {
  prompt: string;
}

export interface SuggestToolParamsResponse {
  parameters: Record<string, unknown>;
}

import type { SoulFileStatus, SoulStackFiles } from "./soul/types";

export type { SoulFileStatus, SoulStackFiles } from "./soul/types";

export interface SoulStatusResponse {
  active: boolean;
  contents?: SoulStackFiles;
  directory: string;
  files: SoulFileStatus;
  profileId?: string;
}

export interface InitSoulResponse {
  created: string[];
  directory: string;
  profileId?: string;
}

export interface SoulStackResponse {
  directory: string;
  files: SoulStackFiles;
  loaded: string[];
  profileId?: string;
}

export interface UpdateSoulFileRequest {
  content: string;
}

export interface ArtifactFile {
  filename: string;
  mimeType: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface ListArtifactsOptions {
  limit?: number;
  offset?: number;
}

export interface ListArtifactsResponse {
  artifacts: ArtifactFile[];
  directory: string;
  limit?: number;
  offset?: number;
  profileId: string;
  total: number;
}

export interface UpdateArtifactRequest {
  content: string;
}

export interface UpdateArtifactResponse {
  filename: string;
  profileId: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface DeleteArtifactResponse {
  deleted: boolean;
  filename: string;
  profileId: string;
}

export interface PublishArtifactShareRequest {
  /** Public web origin for minting share URLs (workers; browsers send Origin). */
  clientOrigin?: string;
  path: string;
}

export interface PublishArtifactShareResponse {
  id: string;
  refreshed: boolean;
  sharePath: string;
  shareUrl: string | null;
  token: string;
  webPublicUrlConfigured: boolean;
}

export interface ArtifactShareStatusResponse {
  active: boolean;
  createdAt: string;
  id: string;
  sharePath: string;
  shareUrl: string | null;
  webPublicUrlConfigured: boolean;
}

export interface RevokeArtifactShareResponse {
  id: string;
  revoked: boolean;
}

export interface PublicArtifactShareResponse {
  filename: string;
  inlineAllowed: boolean;
  mimeType: string;
  sizeBytes: number;
}

export type KnowledgeBaseDocumentStatus = "ready" | "failed";

export interface KnowledgeBaseDocument {
  error?: string;
  filename: string;
  id: string;
  mediaType: string;
  sizeBytes: number;
  status: KnowledgeBaseDocumentStatus;
  uploadedAt: string;
}

export interface KnowledgeBaseSource {
  description: string;
  enabled: boolean;
  id: string;
  inherited: boolean;
  kind: "url";
  title: string;
  url: string;
}

export interface ListKnowledgeBaseResponse {
  documents: KnowledgeBaseDocument[];
  profileId: string;
  sources: KnowledgeBaseSource[];
}

export interface UploadKnowledgeBaseRequest {
  document: DocumentAttachment;
}

export interface UploadKnowledgeBaseResponse {
  document: KnowledgeBaseDocument;
  profileId: string;
}

export interface DeleteKnowledgeBaseResponse {
  deleted: boolean;
  documentId: string;
  profileId: string;
}

export interface UserContextStatusResponse {
  active: boolean;
  content?: string;
}

export interface UpdateUserContextRequest {
  content: string;
}

export interface InitUserContextResponse {
  created: boolean;
}

export type ProviderName =
  | "openai"
  | "anthropic"
  | "openrouter"
  | "gemini"
  | "deepseek"
  | "cerebras"
  | "fireworks"
  | "ollama"
  | "openai_compatible"
  | "opencode_go";

export type OllamaHostMode = "local" | "cloud";

export type GenerateTextFormat = "json" | "text";

export interface GenerateTextInput {
  /** Defaults to `json` for structured automation drafts. Use `text` for plain prose. */
  format?: GenerateTextFormat;
  prompt: string;
  system: string;
}

export interface JsonSchema {
  additionalProperties?: boolean | JsonSchema;
  description?: string;
  enum?: Array<string | number | boolean>;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  type?: string;
}

export interface LlmToolDefinition {
  description: string;
  name: string;
  parameters: JsonSchema;
}

export interface ToolCall {
  arguments: Record<string, unknown>;
  id: string;
  name: string;
}

export type ChatMessage =
  | { role: "user"; content: string | MessageContentPart[] }
  | {
      role: "assistant";
      content: string;
      /** Model reasoning trace for display; not sent as plain assistant text to providers. */
      thinking?: string;
      summary?: boolean;
      toolCalls?: ToolCall[];
      /** Provider-specific assistant payload for multi-turn replay (Anthropic blocks, OpenAI response items). */
      providerContent?: unknown[];
    }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ChatCompletionResult {
  assistantMessage: Extract<ChatMessage, { role: "assistant" }>;
  content: string;
  toolCalls: ToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    /** True when input/output tokens were estimated rather than reported by the provider. */
    estimated?: boolean;
  };
}

export interface GenerateTextResult {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface ProviderChatOptions {
  thinking?: {
    enabled: boolean;
    effort?: ThinkingEffort;
  };
  /** Use the active provider's hosted web search instead of executing web_search locally. */
  webSearch?: boolean;
}

export interface GenerateChatInput {
  messages: ChatMessage[];
  providerOptions?: ProviderChatOptions;
  /**
   * Aborts the upstream request when the caller cancels the turn. Providers must
   * pass it to their HTTP client, otherwise a cancelled chat keeps streaming and
   * billing until the model finishes.
   */
  signal?: AbortSignal;
  system: string;
  tools?: LlmToolDefinition[];
}

export interface StreamChatHandlers {
  onChunk: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onToolEnd?: (event: {
    toolCallId: string;
    tool: string;
    result: unknown;
  }) => void;
  onToolInputDelta?: (event: {
    toolCallId: string;
    tool: string;
    delta: string;
    accumulatedArguments?: string;
  }) => void;
  onToolStart?: (event: {
    toolCallId: string;
    tool: string;
    input: Record<string, unknown>;
  }) => void;
}

export interface ProviderClient {
  generateChat(input: GenerateChatInput): Promise<ChatCompletionResult>;
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
  name: ProviderName;
  streamChat(
    input: GenerateChatInput,
    handlers: StreamChatHandlers
  ): Promise<ChatCompletionResult>;
}

export interface ToolContext {
  /** Nesting depth for sub-agent execution (0 = parent, 1 = child). */
  agentDepth?: number;
  automationId?: string;
  automationRunId?: string;
  /** Session channel when known (used for interactive-only tool gates). */
  channel?: AgentChannel;
  /** Browser origin for OAuth callbacks during this tool run. */
  clientOrigin?: string;
  /** Emits concise live status lines while a sub-agent child loop runs (parent web UI). */
  emitSubAgentActivity?: (label: string) => void;
  /**
   * When true (skill_manage is in the session tool list), write_file / edit_file / delete_file
   * refuse paths matching skills/<name>/SKILL.md under the profile workspace.
   */
  forbidProfileSkillMarkdownWrites?: boolean;
  /** Loads a provider-neutral document/image reference scoped to this execution. */
  loadAttachment?: LoadAttachmentBytes;
  orgId?: string;
  /** Org role of the invoking user. Org-memory tools gate on this; undefined means deny-by-default. */
  orgRole?: OrgRole;
  profileId?: string;
  /**
   * Records bytes an optimiser removed from a tool result before insertion.
   * Passed in rather than imported because the database lives in the server and
   * this runs in core. Optional and fire-and-forget: a platform that does not
   * record anything simply leaves it undefined.
   */
  recordToolOutputSavings?: (saving: {
    bytesIn: number;
    bytesOut: number;
    optimizer: string;
    tool: string;
  }) => void;
  /**
   * Records what the provider actually charged for one request, tagged with
   * whether the optimiser was active. This is the only honest route from bytes
   * to tokens: the provider counts, split by arm.
   */
  recordTurnUsage?: (turn: {
    estimated: boolean;
    inputTokens: number;
    optimized: boolean;
    outputTokens: number;
  }) => void;
  sessionId?: string;
  /** Aborts when the caller cancels the turn. Long-running tools should stop their work on it. */
  signal?: AbortSignal;
  /**
   * Per-org override for the tool-output optimiser. Undefined means the setting
   * was never chosen, which falls back to the server's NAKAMA_OMNI env var.
   */
  tokenOptimizerEnabled?: boolean | null;
  userId?: string;
  /** Profile workspace root (~/.nakama/orgs/{orgId}/profiles/{profileId}/). */
  workspaceRoot?: string;
}

export interface ToolDefinition<Input = unknown, Output = unknown> {
  description: string;
  name: string;
  /** When true, this tool may run concurrently with other parallelSafe tools in the same turn. */
  parallelSafe?: boolean;
  parameters?: JsonSchema;
  run(input: Input, context: ToolContext): Promise<Output>;
}

export const COMPOSIO_TOOLKIT_SLUG_PATTERN = /^[a-z0-9_-]+$/;

export type ComposioOrgToolkitStatus = "disabled" | "enabled";

export type ComposioUserConnectionStatus =
  | "oauth_in_progress"
  | "connected"
  | "error";

/** @deprecated Org catalog uses ComposioOrgToolkitStatus; user rows use ComposioUserConnectionStatus. */
export type ComposioToolkitStatus =
  | ComposioOrgToolkitStatus
  | ComposioUserConnectionStatus;

export type ComposioToolErrorCode =
  | "COMPOSIO_NOT_CONNECTED"
  | "COMPOSIO_TRANSIENT"
  | "COMPOSIO_POLICY";

export interface ComposioCachedToolSummary {
  description: string;
  inputSchema: Record<string, unknown>;
  name: string;
  slug: string;
}

export interface ComposioToolkitSummary {
  cachedTools: ComposioCachedToolSummary[];
  displayName: string;
  id: string;
  lastError: string | null;
  status: ComposioOrgToolkitStatus;
  toolkitSlug: string;
  updatedAt: string;
}

export interface ComposioUserConnectionSummary {
  id: string;
  lastError: string | null;
  status: ComposioUserConnectionStatus;
  toolkitId: string;
  toolkitSlug: string;
  updatedAt: string;
}

export interface ComposioCatalogToolkitSummary {
  description: string | null;
  logoUrl: string | null;
  name: string;
  slug: string;
}

export interface ListComposioToolkitsResponse {
  catalog: ComposioCatalogToolkitSummary[];
  catalogError: string | null;
  /** @deprecated Use composioReachable. */
  composioAvailable: boolean;
  /** Nakama can reach the Composio API with the saved key. */
  composioReachable: boolean;
  /** A Composio project API key is saved on this server. */
  configured: boolean;
  orgToolkits: ComposioToolkitSummary[];
  userConnections: ComposioUserConnectionSummary[];
}

export interface EnableComposioToolkitRequest {
  toolkitSlug: string;
}

export interface ComposioConnectRequest {
  /** Browser origin for OAuth callback (e.g. http://localhost:3003). */
  callbackOrigin?: string;
}

export interface ComposioConnectResponse {
  redirectUrl: string;
}

export interface ProfileComposioToolkitAssignment {
  allowedActions: string[] | null;
  toolkitId: string;
  toolkitSlug: string;
}

export interface ListProfileComposioToolkitsResponse {
  assignments: ProfileComposioToolkitAssignment[];
}

export interface UpdateProfileComposioToolkitsRequest {
  assignments: Array<{
    toolkitId: string;
    allowedActions?: string[] | null;
  }>;
}

export interface ComposioToolErrorResult {
  code: ComposioToolErrorCode;
  error: string;
  toolkitSlug?: string;
}
