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
  authToken?: string;
  baseUrl?: string;
  /** Browser-style origin for OAuth callbacks when this client has no window (e.g. Telegram bridge). */
  clientOrigin?: string;
  credentials?: FetchCredentials;
  fetch?: typeof fetch;
  orgId?: string | null;
}

export type StreamHandler = (delta: string) => void;

export interface StreamHandlers {
  onChunk: StreamHandler;
  onContextUsage?: (usage: ChatContextUsage) => void;
  onQuestionnaireUpdated?: (questionnaire: AgentQuestionnaire | null) => void;
  onSubAgentActivity?: (event: {
    parentToolCallId: string;
    label: string;
  }) => void;
  onThinking?: StreamHandler;
  onTodosUpdated?: (todos: AgentTodo[]) => void;
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

export type SendMessageArg = string | SendMessageInput;

export interface SendStreamOptions {
  signal?: AbortSignal;
}

export interface RemoteChatSession {
  clear(): Promise<void>;
  compact(options?: { force?: boolean }): Promise<CompactionResponse>;
  createAutomation(prompt: string): Promise<AutomationDefinition>;
  getMessages(): Promise<ChatMessage[]>;
  id: string;
  purge(): Promise<void>;
  send(input: SendMessageArg): Promise<string>;
  sendStream(
    input: SendMessageArg,
    handler: StreamHandler | StreamHandlers,
    options?: SendStreamOptions
  ): Promise<string>;
  subscribeStream(
    handler: StreamHandler | StreamHandlers,
    options?: SendStreamOptions
  ): Promise<{ reconnected: boolean; reply?: string }>;
}
