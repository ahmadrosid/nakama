export type AutomationTrigger =
  | { type: "manual" }
  | { type: "schedule"; cron: string; timezone?: string };

export interface AutomationStep {
  id: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface AutomationDefinition {
  id: string;
  name: string;
  description: string;
  prompt: string;
  trigger: AutomationTrigger;
  steps: AutomationStep[];
  version: number;
}

export interface StoredAutomation extends AutomationDefinition {
  profileId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
}

export type AutomationRunStatus = "running" | "completed" | "failed";

export interface AutomationRunRecord {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  startedAt: string;
  completedAt: string | null;
  output: string | null;
  error: string | null;
}

export type AgentChannel = "web" | "cli" | "telegram" | "whatsapp" | "automation" | "task";

export const TINYCLAW_API_VERSION = 1;

export interface HealthResponse {
  ok: true;
  apiVersion: typeof TINYCLAW_API_VERSION;
  providerConfigured: boolean;
  userConfigured: boolean;
}

export interface AutomationWorkerStatus {
  ok: boolean;
  running: boolean;
  scheduledJobs: number;
  activeRuns: number;
  providerConfigured: boolean;
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

export interface LlmUsageStatus extends LlmUsageStats {
  provider: ProviderName | null;
  currentModel: string | null;
  providerConfigured: boolean;
  displayName: string | null;
  costEstimated: boolean;
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

export interface AuthCredentialsRequest {
  email: string;
  password: string;
}

export interface AuthUserResponse {
  email: string;
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

export interface SessionMessageMeta {
  id: string;
  seq: number;
  createdAt: string;
}

export interface SessionMessagesResponse {
  messages: ChatMessage[];
  messageMeta: SessionMessageMeta[];
  todos: AgentTodo[];
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
  | { type: "image"; mediaType: string; data: string }
  | { type: "document"; filename: string; mediaType: string; data: string };

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
}

export interface UpdateAutomationRequest {
  name?: string;
  description?: string;
  prompt?: string;
  trigger?: AutomationTrigger;
  enabled?: boolean;
}

export interface RunAutomationResponse {
  run: AutomationRunRecord;
}

export interface ListAutomationRunsResponse {
  runs: AutomationRunRecord[];
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

export interface ApiErrorResponse {
  error: string;
}

export interface CustomModelEntry {
  id: string;
  name?: string;
  default?: boolean;
  supportsThinking?: boolean;
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
  baseUrl: string;
  apiKey?: string;
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
  thinkingEnabled: boolean | null;
  thinkingEffort: ThinkingEffort | null;
  effectiveThinkingEnabled: boolean;
  effectiveThinkingEffort: ThinkingEffort;
  isSuper: boolean;
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
  name: string;
  systemPrompt?: string;
  model?: string | null;
  thinkingEnabled?: boolean | null;
  thinkingEffort?: ThinkingEffort | null;
  isSuper?: boolean;
}

export interface UpdateProfileRequest {
  name?: string;
  systemPrompt?: string;
  model?: string | null;
  thinkingEnabled?: boolean | null;
  thinkingEffort?: ThinkingEffort | null;
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

export interface ListKnowledgeBaseResponse {
  documents: KnowledgeBaseDocument[];
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
  path: string;
  active: boolean;
  content?: string;
}

export interface UpdateUserContextRequest {
  content: string;
}

export interface InitUserContextResponse {
  path: string;
  created: boolean;
}

export type ProviderName =
  | "openai"
  | "anthropic"
  | "openrouter"
  | "gemini"
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
  generateText(input: GenerateTextInput): Promise<string>;
  generateChat(input: GenerateChatInput): Promise<ChatCompletionResult>;
  streamChat(
    input: GenerateChatInput,
    handlers: StreamChatHandlers,
  ): Promise<ChatCompletionResult>;
}

export interface ToolContext {
  automationId?: string;
  userId?: string;
  profileId?: string;
  sessionId?: string;
}

export interface ToolDefinition<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  parameters?: JsonSchema;
  run(input: Input, context: ToolContext): Promise<Output>;
}
