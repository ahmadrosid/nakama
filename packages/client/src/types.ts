import type {
  AgentTodo,
  AutomationDefinition,
  ChatMessage,
  CompactionResponse,
  SendMessageInput,
} from "@tinyclaw/core/contract";

export interface TinyClawClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  authToken?: string;
  credentials?: RequestCredentials;
  orgId?: string | null;
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
