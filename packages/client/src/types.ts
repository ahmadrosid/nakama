import type {
  AgentQuestionnaire,
  AgentTodo,
  AutomationDefinition,
  ChatMessage,
  CompactionResponse,
  SendMessageInput,
} from "@nakama/core/contract";

export interface NakamaClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  authToken?: string;
  credentials?: RequestCredentials;
  orgId?: string | null;
  /** Browser-style origin for OAuth callbacks when this client has no window (e.g. Telegram bridge). */
  clientOrigin?: string;
}

export type StreamHandler = (delta: string) => void;

export interface StreamHandlers {
  onChunk: StreamHandler;
  onThinking?: StreamHandler;
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
  onTodosUpdated?: (todos: AgentTodo[]) => void;
  onQuestionnaireUpdated?: (questionnaire: AgentQuestionnaire | null) => void;
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
  createAutomation(prompt: string): Promise<AutomationDefinition>;
}
