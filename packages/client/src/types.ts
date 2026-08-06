import type {
  AgentQuestionnaire,
  AgentTodo,
  AutomationDefinition,
  ChatContextUsage,
  ChatMessage,
  CompactionResponse,
  SendMessageInput,
} from "@nakama/core/contract";

/** Fetch `credentials` option (same values as the standard `RequestCredentials` type). */
export type FetchCredentials = "omit" | "same-origin" | "include";

/** Binary buffer input (same values as the standard `BufferSource` type). */
export type BinaryBufferSource = ArrayBuffer | ArrayBufferView;

export interface NakamaClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  authToken?: string;
  credentials?: FetchCredentials;
  orgId?: string | null;
  /** Browser-style origin for OAuth callbacks when this client has no window (e.g. Telegram bridge). */
  clientOrigin?: string;
}

export type StreamHandler = (delta: string) => void;

export interface StreamHandlers {
  onChunk: StreamHandler;
  onThinking?: StreamHandler;
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
  onToolEnd?: (event: {
    toolCallId: string;
    tool: string;
    result: unknown;
  }) => void;
  onSubAgentActivity?: (event: { parentToolCallId: string; label: string }) => void;
  onTodosUpdated?: (todos: AgentTodo[]) => void;
  onQuestionnaireUpdated?: (questionnaire: AgentQuestionnaire | null) => void;
  onContextUsage?: (usage: ChatContextUsage) => void;
}

export type SendMessageArg = string | SendMessageInput;

export interface SendStreamOptions {
  signal?: AbortSignal;
}

export interface RemoteChatSession {
  id: string;
  send(input: SendMessageArg): Promise<string>;
  sendStream(
    input: SendMessageArg,
    handler: StreamHandler | StreamHandlers,
    options?: SendStreamOptions,
  ): Promise<string>;
  compact(options?: { force?: boolean }): Promise<CompactionResponse>;
  clear(): Promise<void>;
  purge(): Promise<void>;
  getMessages(): Promise<ChatMessage[]>;
  subscribeStream(
    handler: StreamHandler | StreamHandlers,
    options?: SendStreamOptions,
  ): Promise<{ reconnected: boolean; reply?: string }>;
  createAutomation(prompt: string): Promise<AutomationDefinition>;
}
