export type AutomationTrigger =
  | { type: "manual" }
  | { type: "schedule"; cron: string; timezone?: string }
  | { type: "runAt"; at: string; timezone?: string };

export interface AutomationStep {
  id: string;
  tool: string;
  input: Record<string, unknown>;
}

export type AutomationDeliveryChannel = "telegram" | "whatsapp" | "email";

export type AutomationDeliveryNotifyOn = "success" | "failure" | "both";

export interface AutomationDelivery {
  channel: AutomationDeliveryChannel;
  /** Required when channel is email. */
  to?: string;
  /** Optional Telegram chat override; defaults to all paired users. */
  chatId?: number;
  notifyOn?: AutomationDeliveryNotifyOn;
}

export interface AutomationDefinition {
  id: string;
  name: string;
  description: string;
  prompt: string;
  trigger: AutomationTrigger;
  steps: AutomationStep[];
  version: number;
  delivery?: AutomationDelivery;
}

export interface StoredAutomation extends AutomationDefinition {
  profileId: string;
  orgId?: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
}

export type AutomationRunStatus = "running" | "completed" | "failed";

export type AutomationDeliveryStatus = "sent" | "failed" | "skipped";

export interface AutomationRunRecord {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  startedAt: string;
  completedAt: string | null;
  output: string | null;
  error: string | null;
  deliveryStatus?: AutomationDeliveryStatus | null;
  deliveryError?: string | null;
  /** Present when the API resolves read state for the current user. */
  read?: boolean;
}

export interface AutomationUnreadSummary {
  totalUnread: number;
  byAutomationId: Record<string, number>;
}

export type AgentChannel = "web" | "cli" | "telegram" | "whatsapp" | "automation" | "task";

export const TINYCLAW_API_VERSION = 1;

export interface HealthResponse {
  ok: true;
  apiVersion: typeof TINYCLAW_API_VERSION;
  providerConfigured: boolean;
  userConfigured: boolean;
}

export interface AutomationSchedule {
  id: string;
  /** Recurring cron trigger — mutually exclusive with runAt. */
  cron?: string;
  /** One-shot ISO-8601 datetime — mutually exclusive with cron. */
  runAt?: string;
  timezone: string | null;
  orgId: string;
  profileId: string;
}

export interface AutomationWorkerStatus {
  ok: boolean;
  running: boolean;
  scheduledJobs: number;
  activeRuns: number;
  providerConfigured: boolean;
  process?: WorkerProcessInfo;
}

export interface TaskWorkerStatus {
  ok: boolean;
  activeRuns: number;
  providerConfigured: boolean;
}

export interface WorkerProcessInfo {
  managed: boolean;
  status: "online" | "stopped" | "errored" | null;
  cpuPercent: number | null;
  memoryMb: number | null;
  uptimeSeconds: number | null;
}

export interface TelegramWorkerStatus {
  ok: boolean;
  configured: boolean;
  paired: boolean;
  running: boolean;
  process?: WorkerProcessInfo;
}

export interface WhatsAppWorkerStatus {
  ok: boolean;
  configured: boolean;
  paired: boolean;
  running: boolean;
  connected: boolean;
  qrCode: string | null;
  process?: WorkerProcessInfo;
}

export interface WorkerLogsResponse {
  stdout: string;
  stderr: string;
}

export interface LlmUsageStats {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  trackedSince: string;
}

export interface LlmUsageModelStats extends LlmUsageStats {
  modelId: string;
}

export interface LlmUsageStatus extends LlmUsageStats {
  provider: ProviderName | null;
  currentModel: string | null;
  providerConfigured: boolean;
  displayName: string | null;
  costEstimated: boolean;
  models: LlmUsageModelStats[];
}

export interface McpStatus {
  serverCount: number;
  connectedCount: number;
  assignedProfileCount: number;
}

export interface SystemStatusResponse {
  server: HealthResponse;
  automationWorker: AutomationWorkerStatus;
  taskWorker: TaskWorkerStatus;
  telegramWorker: TelegramWorkerStatus;
  whatsappWorker: WhatsAppWorkerStatus;
  llmUsage: LlmUsageStatus;
  mcp: McpStatus;
  checkedAt: string;
}

export interface DataExportSkippedItem {
  path: string;
  reason: string;
}

export interface DataExportManifest {
  kind: "tinyclaw-export";
  version: number;
  apiVersion: typeof TINYCLAW_API_VERSION;
  createdAt: string;
  sourceRootName: string;
  topLevelPaths: string[];
  fileCount: number;
  totalBytes: number;
  skipped: DataExportSkippedItem[];
}

export interface DataImportPreviewResponse {
  manifest: DataExportManifest;
  archiveFileCount: number;
  archiveTotalBytes: number;
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
  restoredRoot: string;
  restoredFileCount: number;
}

export interface AuthCredentialsRequest {
  email: string;
  password: string;
}

export interface SetupAuthRequest {
  organization: {
    name: string;
    slug: string;
  };
  admin: {
    name: string;
    email: string;
    phone?: string;
    password: string;
  };
}

export interface AuthUserResponse {
  email: string;
  isPlatformAdmin?: boolean;
  activeOrgId?: string | null;
  orgId?: string | null;
}

export type OrgRole = "admin" | "member" | "viewer";
export type ChannelType = "telegram" | "whatsapp";

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrganizationRequest {
  name: string;
  slug: string;
  admin?: {
    name: string;
    email: string;
    phone: string;
  };
}

export interface UpdateOrganizationRequest {
  name: string;
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
  organization: OrganizationSummary;
  adminMember?: AddOrgMemberResponse;
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
  userId: string;
  name: string | null;
  email: string;
  phone: string | null;
  role: OrgRole;
  createdAt: string;
}

export interface ListOrgMembersResponse {
  members: OrgMemberSummary[];
}

export interface AddOrgMemberRequest {
  name: string;
  email: string;
  phone: string;
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

export interface InviteOrgMemberRequest {
  email: string;
  role: OrgRole;
}

export interface OrgInviteSummary {
  id: string;
  orgId: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
  createdAt: string;
}

export interface AcceptOrgInviteRequest {
  token: string;
  password?: string;
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
  userId: string;
  orgId: string;
  createdAt: string;
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

export type AgentTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface AgentTodo {
  id: string;
  content: string;
  status: AgentTodoStatus;
}

export interface AgentQuestionChoice {
  id: string;
  label: string;
}

export interface AgentQuestionItem {
  id: string;
  prompt: string;
  choices: AgentQuestionChoice[];
  allowCustomAnswer: boolean;
  placeholder?: string;
}

export interface AgentQuestionnaire {
  id: string;
  title: string;
  questions: AgentQuestionItem[];
}

export interface AgentQuestionAnswer {
  questionId: string;
  prompt: string;
  answer: string;
}

export interface SessionMessageMeta {
  id: string;
  seq: number;
  createdAt: string;
}

export interface SessionMessagesResponse {
  channel: AgentChannel;
  messages: ChatMessage[];
  messageMeta: SessionMessageMeta[];
  todos: AgentTodo[];
  questionnaire: AgentQuestionnaire | null;
}

export interface SessionSummary {
  id: string;
  profileId: string;
  channel: AgentChannel;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  title: string | null;
  preview: string | null;
}

export interface ListSessionsResponse {
  sessions: SessionSummary[];
}

export interface CompactSessionRequest {
  force?: boolean;
}

export interface CompactionResponse {
  action: "none" | "pruned" | "summarized";
  prunedTokens?: number;
  messagesBefore: number;
  messagesAfter: number;
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
  mediaType: string;
  data: string;
}

export interface DocumentAttachment {
  filename: string;
  mediaType: string;
  data: string;
}

export interface SendMessageInput {
  message: string;
  images?: ImageAttachment[];
  documents?: DocumentAttachment[];
}

export interface SendMessageRequest {
  message: string;
  images?: ImageAttachment[];
  documents?: DocumentAttachment[];
  stream?: boolean;
}

export interface SendMessageResponse {
  reply: string;
}

export type StreamEvent =
  | { type: "chunk"; delta: string }
  | { type: "thinking"; delta: string }
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
  | { type: "done"; reply: string }
  | { type: "error"; error: string };

export interface DraftAutomationRequest {
  prompt: string;
  channel: AgentChannel;
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
  name: string;
  description: string;
  prompt: string;
  trigger: AutomationTrigger;
  profileId?: string;
  enabled?: boolean;
  delivery?: AutomationDelivery;
}

export interface UpdateAutomationRequest {
  name?: string;
  description?: string;
  prompt?: string;
  trigger?: AutomationTrigger;
  enabled?: boolean;
  delivery?: AutomationDelivery | null;
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
  id: string;
  title: string;
  description: string;
  prompt: string;
  profileId: string;
  status: TaskStatus;
  position: number;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DraftTaskPromptRequest {
  title: string;
  description?: string;
}

export interface DraftTaskPromptResponse {
  prompt: string;
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  prompt: string;
  profileId?: string;
  status?: TaskStatus;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  prompt?: string;
  profileId?: string;
  status?: TaskStatus;
  position?: number;
}

export interface ListTasksResponse {
  tasks: StoredTask[];
}

export interface TaskResponse {
  task: StoredTask;
}

export type TaskRunStatus = "running" | "completed" | "failed";

export interface TaskRunRecord {
  id: string;
  taskId: string;
  status: TaskRunStatus;
  startedAt: string;
  completedAt: string | null;
  output: string | null;
  error: string | null;
}

export interface RunTaskResponse {
  run: TaskRunRecord;
}

export interface ListTaskRunsResponse {
  runs: TaskRunRecord[];
}

export interface TaskMessagesResponse {
  sessionId: string;
  messages: ChatMessage[];
}

export interface TimezoneSettingsResponse {
  timezone: string;
}

export interface UpdateTimezoneRequest {
  timezone: string;
}

export type ThinkingEffort = "low" | "medium" | "high";

export interface ThinkingSettings {
  enabled: boolean;
  effort: ThinkingEffort;
}

export interface ThinkingSettingsResponse {
  thinking: ThinkingSettings;
}

export interface UpdateThinkingRequest {
  enabled: boolean;
  effort?: ThinkingEffort;
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
  mediaType: string;
  data: string;
  filename?: string;
}

export interface TranscribeAudioResponse {
  text: string;
}

export interface RotateLocalAuthTokenResponse {
  token: string;
}

export interface TelegramSettingsResponse {
  configured: boolean;
  botTokenMasked: string | null;
  handshakeCode: string | null;
  pairedUserIds: number[];
  allowedUserIds: number[];
  profileId: string;
}

export interface UpdateTelegramSettingsRequest {
  botToken?: string;
  allowedUserIds?: string;
  profileId?: string;
}

export interface EmailSettingsResponse {
  configured: boolean;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  username: string | null;
  from: string | null;
  fromName: string | null;
  passwordMasked: string | null;
}

export interface UpdateEmailSettingsRequest {
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  username?: string;
  password?: string;
  from?: string;
  fromName?: string;
}

export interface SendEmailTestRequest {
  to?: string;
}

export interface SendEmailTestResponse {
  ok: true;
  to: string;
  messageId: string;
}

export interface WhatsAppSettingsResponse {
  configured: boolean;
  phoneNumberMasked: string | null;
  pairingCode: string | null;
  pairedJid: string | null;
  profileId: string;
}

export interface UpdateWhatsAppSettingsRequest {
  phoneNumber?: string;
  profileId?: string;
}

export interface TimezoneCatalogEntry {
  id: string;
  countryCode: string;
  countryName: string;
  city: string;
  label: string;
  offset: string;
  abbreviation: string;
  tzName: string;
  /** Extra searchable city names (e.g. San Francisco → America/Los_Angeles). */
  aliases?: string[];
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
  id: string;
  name?: string;
  default?: boolean;
  supportsThinking?: boolean;
  supportsVision?: boolean;
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
}

export interface ProviderModelOption {
  id: string;
  name: string;
  provider: ProviderName;
  providerId?: string;
  providerLabel?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  default?: boolean;
  supportsThinking?: boolean;
  supportsVision?: boolean;
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
}

export interface ProviderInstanceSummary {
  id: string;
  type: ProviderName;
  label: string;
  hasApiKey: boolean;
  baseUrl?: string | null;
  customModels?: CustomModelEntry[];
  modelCount: number;
  createdAt: string;
}

export interface ListProvidersResponse {
  providers: ProviderInstanceSummary[];
  defaultProviderId: string | null;
}

export interface CreateProviderRequest {
  type: ProviderName;
  label?: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  customModels?: CustomModelEntry[];
}

export interface CreateProviderResponse {
  provider: ProviderInstanceSummary;
  defaultProviderId: string;
  initialModel: string;
}

export interface UpdateProviderRequest {
  label?: string;
  apiKey?: string;
  baseUrl?: string;
  customModels?: CustomModelEntry[];
}

export interface UpdateProviderResponse {
  provider: ProviderInstanceSummary;
}

export interface DeleteProviderResponse {
  defaultProviderId: string | null;
}

export interface ModelsResponse {
  currentProviderId: string | null;
  providers: ProviderInstanceSummary[];
  models: ProviderModelOption[];
  /** Full static model catalog for provider setup and management UIs. */
  catalog?: ProviderModelOption[];
  provider: ProviderName | null;
  displayName: string | null;
  baseUrl?: string | null;
  customModels?: CustomModelEntry[];
}

export interface DiscoverModelsRequest {
  baseUrl?: string;
  apiKey?: string;
  providerId?: string;
}

export interface ConfigureProviderRequest {
  apiKey: string;
  provider: ProviderName;
  model?: string;
  displayName?: string;
  baseUrl?: string;
  customModels?: CustomModelEntry[];
}

export interface ConfigureProviderResponse {
  provider: ProviderName;
  currentModel: string;
  displayName: string | null;
}

export interface ProfileSummary {
  id: string;
  name: string;
  model: string | null;
  isSuper: boolean;
  isDefault?: boolean;
  toolCount: number;
  mcpServerCount: number;
  soulActive: boolean;
  hasAvatar: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileDetail extends ProfileSummary {
  systemPrompt: string;
  tools: ToolSummary[];
  mcpServers: McpServerSummary[];
  skills: SkillSummary[];
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  sourcePath: string;
  hasTool: boolean;
  disableModelInvocation: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
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

export interface CreateSkillRequest {
  name: string;
  description: string;
  body?: string;
  disableModelInvocation?: boolean;
  profileId?: string;
}

export interface SyncSkillsResponse {
  discovered: number;
  created: number;
  updated: number;
}

export type McpServerStatus = "connected" | "disconnected" | "error";
export type McpTransport = "http" | "stdio";

export interface McpHttpConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface McpStdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type McpServerConfig = McpHttpConfig | McpStdioConfig;

export interface CachedMcpToolSummary {
  name: string;
  description: string;
  inputSchema?: unknown;
}

export interface McpServerSummary {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  status: McpServerStatus;
  toolCount: number;
  assignedProfileCount?: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerDetail extends McpServerSummary {
  config: McpServerConfig;
  cachedTools: CachedMcpToolSummary[];
}

export interface ListMcpServersResponse {
  servers: McpServerSummary[];
}

export interface McpServerResponse {
  server: McpServerDetail;
}

export interface CreateMcpServerRequest {
  name: string;
  transport: McpTransport;
  config: McpServerConfig;
  enabled?: boolean;
  connect?: boolean;
  /** When testing an existing server, merges blank header/env values with stored secrets. */
  serverId?: string;
}

export interface UpdateMcpServerRequest {
  name?: string;
  transport?: McpTransport;
  config?: McpServerConfig;
  enabled?: boolean;
}

export interface AssignMcpServerRequest {
  serverId: string;
}

export interface TestMcpServerResponse {
  ok: boolean;
  toolCount: number;
  tools: CachedMcpToolSummary[];
  error?: string;
}

export interface ToolSummary {
  id: string;
  name: string;
  description: string;
  handlerType: string;
}

export interface ToolDetail extends ToolSummary {
  handlerConfig: unknown;
  /** Resolved JSON Schema for javascript tools (module export or handlerConfig). */
  parameters?: JsonSchema;
  createdAt: string;
  updatedAt: string;
}

export interface ToolResponse {
  tool: ToolDetail;
}

export interface ToolSourceResponse {
  path: string;
  content: string;
  language: "javascript" | "typescript";
}

export interface ListProfilesResponse {
  profiles: ProfileSummary[];
}

export interface ProfileResponse {
  profile: ProfileDetail;
}

export interface CreateProfileRequest {
  id?: string;
  name: string;
  systemPrompt?: string;
  model?: string | null;
  isSuper?: boolean;
}

export interface UpdateProfileRequest {
  name?: string;
  systemPrompt?: string;
  model?: string | null;
}

export interface CreateToolRequest {
  name: string;
  description: string;
  handlerType?: string;
  handlerConfig?: unknown;
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
  ok: boolean;
  result?: unknown;
  error?: string;
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
  directory: string;
  active: boolean;
  files: SoulFileStatus;
  contents?: SoulStackFiles;
  profileId?: string;
}

export interface InitSoulResponse {
  directory: string;
  created: string[];
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

export type SaveArtifactMode = "text" | "base64";

export interface ArtifactFile {
  filename: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface ListArtifactsResponse {
  profileId: string;
  directory: string;
  artifacts: ArtifactFile[];
}

export interface DeleteArtifactResponse {
  deleted: boolean;
  profileId: string;
  filename: string;
}

export type KnowledgeBaseDocumentStatus = "ready" | "failed";

export interface KnowledgeBaseDocument {
  id: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  uploadedAt: string;
  status: KnowledgeBaseDocumentStatus;
  error?: string;
}

export interface KnowledgeBaseSource {
  id: string;
  title: string;
  url: string;
  description: string;
  kind: "url";
  inherited: boolean;
  enabled: boolean;
}

export interface ListKnowledgeBaseResponse {
  documents: KnowledgeBaseDocument[];
  sources: KnowledgeBaseSource[];
  profileId: string;
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
  profileId: string;
  documentId: string;
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
  | "openai_compatible"
  | "opencode_go";

export type GenerateTextFormat = "json" | "text";

export interface GenerateTextInput {
  system: string;
  prompt: string;
  /** Defaults to `json` for structured automation drafts. Use `text` for plain prose. */
  format?: GenerateTextFormat;
}

export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  enum?: Array<string | number | boolean>;
  items?: JsonSchema;
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
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
  content: string;
  toolCalls: ToolCall[];
  assistantMessage: Extract<ChatMessage, { role: "assistant" }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
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
  /** Use the active provider's hosted web search instead of executing web_search locally. */
  webSearch?: boolean;
  thinking?: {
    enabled: boolean;
    effort?: ThinkingEffort;
  };
}

export interface GenerateChatInput {
  system: string;
  messages: ChatMessage[];
  tools?: LlmToolDefinition[];
  providerOptions?: ProviderChatOptions;
}

export interface StreamChatHandlers {
  onChunk: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onToolStart?: (event: {
    toolCallId: string;
    tool: string;
    input: Record<string, unknown>;
  }) => void;
  onToolEnd?: (event: {
    toolCallId: string;
    tool: string;
    result: unknown;
  }) => void;
}

export interface ProviderClient {
  name: ProviderName;
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
  generateChat(input: GenerateChatInput): Promise<ChatCompletionResult>;
  streamChat(
    input: GenerateChatInput,
    handlers: StreamChatHandlers,
  ): Promise<ChatCompletionResult>;
}

export interface ToolContext {
  automationId?: string;
  automationRunId?: string;
  userId?: string;
  orgId?: string;
  profileId?: string;
  sessionId?: string;
  /** Profile workspace root (~/.tinyclaw/orgs/{orgId}/profiles/{profileId}/). */
  workspaceRoot?: string;
}

export interface ToolDefinition<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  parameters?: JsonSchema;
  run(input: Input, context: ToolContext): Promise<Output>;
}

export interface SaveArtifactOutput {
  filename: string;
  path: string;
  mimeType: string;
  mode: SaveArtifactMode;
  bytesWritten: number;
}
