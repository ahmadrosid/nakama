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

export type AgentChannel = "web" | "cli" | "telegram" | "automation" | "task";

export const TINYCLAW_API_VERSION = 1;

export interface HealthResponse {
  ok: true;
  apiVersion: typeof TINYCLAW_API_VERSION;
  providerConfigured: boolean;
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

export interface SystemStatusResponse {
  server: HealthResponse;
  automationWorker: AutomationWorkerStatus;
  taskWorker: TaskWorkerStatus;
  checkedAt: string;
}

export interface CreateSessionRequest {
  channel: AgentChannel;
  profileId?: string;
}

export interface CreateSessionResponse {
  sessionId: string;
}

export interface SessionMessagesResponse {
  messages: ChatMessage[];
}

export interface SessionSummary {
  id: string;
  profileId: string;
  channel: AgentChannel;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
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
  | { type: "image"; mediaType: string; data: string };

export interface ImageAttachment {
  mediaType: string;
  data: string;
}

export interface SendMessageInput {
  message: string;
  images?: ImageAttachment[];
}

export interface SendMessageRequest {
  message: string;
  images?: ImageAttachment[];
  stream?: boolean;
}

export interface SendMessageResponse {
  reply: string;
}

export type StreamEvent =
  | { type: "chunk"; delta: string }
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

export interface ProviderModelOption {
  id: string;
  name: string;
  provider: "openai" | "anthropic";
  default?: boolean;
}

export interface ModelsResponse {
  provider: "openai" | "anthropic" | null;
  currentModel: string | null;
  defaultModel: string | null;
  models: ProviderModelOption[];
}

export interface SetModelRequest {
  model: string;
}

export interface SetModelResponse {
  provider: "openai" | "anthropic";
  currentModel: string;
}

export interface ConfigureProviderRequest {
  apiKey: string;
  model?: string;
}

export interface ConfigureProviderResponse {
  provider: "openai" | "anthropic";
  currentModel: string;
}

export interface ProfileSummary {
  id: string;
  name: string;
  model: string | null;
  isSuper: boolean;
  toolCount: number;
  soulActive: boolean;
  hasAvatar: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileDetail extends ProfileSummary {
  systemPrompt: string;
  tools: ToolSummary[];
}

export interface ToolSummary {
  id: string;
  name: string;
  description: string;
  handlerType: string;
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
  tools: ToolSummary[];
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

export type ProviderName = "openai" | "anthropic";

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
}

export interface GenerateChatInput {
  system: string;
  messages: ChatMessage[];
  tools?: LlmToolDefinition[];
  providerOptions?: ProviderChatOptions;
}

export interface StreamChatHandlers {
  onChunk: (delta: string) => void;
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
