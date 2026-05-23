import type {
  AutomationDefinition,
  ChatMessage,
  ProviderClient,
  ToolCall,
  ToolDefinition,
} from "@tinyclaw/core";
import { partitionTools, toLlmToolDefinitions } from "@tinyclaw/core";
import { buildChatSystemPrompt } from "./chat-prompt";
import {
  buildAutomationSystemPrompt,
  buildAutomationUserPrompt,
} from "./prompt";
import { parseAutomationResponse } from "./parse";
import type { AgentDependencies, AgentRequest } from "./types";
import { executeToolCall, serializeToolResult } from "./tool-loop";

const MAX_TOOL_ITERATIONS = 5;

export interface StreamHandlers {
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

export interface AgentChatSession {
  send(message: string): Promise<string>;
  sendStream(message: string, handlers: StreamHandlers): Promise<string>;
  clear(): void;
  getHistory(): readonly ChatMessage[];
  createAutomation(prompt: string): Promise<AutomationDefinition>;
}

export interface AgentChatSessionOptions {
  channel?: AgentRequest["channel"];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  enableToolLoop?: boolean;
  soul?: boolean;
  initialHistory?: ChatMessage[];
}

export function createAgentChatSession(
  dependencies: AgentDependencies,
  harness: {
    createAutomationFromPrompt(
      request: AgentRequest,
      options?: { tools?: ToolDefinition[] },
    ): Promise<AutomationDefinition>;
  },
  options: AgentChatSessionOptions = {},
): AgentChatSession {
  const channel = options.channel ?? "cli";
  const tools = options.tools ?? dependencies.tools ?? [];
  const enableToolLoop = options.enableToolLoop ?? tools.length > 0;
  const systemPrompt = buildChatSystemPrompt(tools, {
    basePrompt: options.systemPrompt,
    enableToolLoop,
    soul: options.soul,
  });
  const history: ChatMessage[] = options.initialHistory
    ? [...options.initialHistory]
    : [];

  return {
    async send(message) {
      return sendMessage(dependencies, tools, systemPrompt, history, message, "send", {
        enableToolLoop,
      });
    },
    async sendStream(message, handlers) {
      return sendMessage(
        dependencies,
        tools,
        systemPrompt,
        history,
        message,
        "stream",
        { enableToolLoop, handlers },
      );
    },
    clear() {
      history.length = 0;
    },
    getHistory() {
      return history;
    },
    createAutomation(prompt) {
      return harness.createAutomationFromPrompt({ prompt, channel }, { tools });
    },
  };
}

async function sendMessage(
  dependencies: AgentDependencies,
  tools: ToolDefinition[],
  systemPrompt: string,
  history: ChatMessage[],
  message: string,
  mode: "send" | "stream",
  options: {
    enableToolLoop: boolean;
    handlers?: StreamHandlers;
  },
): Promise<string> {
  history.push({ role: "user", content: message });

  if (!dependencies.provider) {
    const reply =
      "I'm running in offline mode. Set OPENAI_API_KEY or ANTHROPIC_API_KEY to chat with me. You can still use /create to draft automations locally.";

    if (mode === "stream" && options.handlers) {
      options.handlers.onChunk(reply);
    }

    history.push({ role: "assistant", content: reply });
    return reply;
  }

  const { localTools, hasWebSearch } = partitionTools(tools);
  const enableTools = options.enableToolLoop && (localTools.length > 0 || hasWebSearch);
  const llmTools =
    enableTools && localTools.length > 0 ? toLlmToolDefinitions(localTools) : undefined;
  const providerOptions =
    enableTools && hasWebSearch && dependencies.provider
      ? { webSearch: true }
      : undefined;

  try {
    const reply = await runConversation(
      dependencies.provider,
      localTools,
      systemPrompt,
      history,
      mode,
      enableTools,
      llmTools,
      providerOptions,
      options.handlers,
    );

    return reply;
  } catch (error) {
    history.pop();
    throw error;
  }
}

async function runConversation(
  provider: ProviderClient,
  tools: ToolDefinition[],
  systemPrompt: string,
  history: ChatMessage[],
  mode: "send" | "stream",
  enableToolLoop: boolean,
  llmTools: ReturnType<typeof toLlmToolDefinitions> | undefined,
  providerOptions: { webSearch?: boolean } | undefined,
  handlers?: StreamHandlers,
): Promise<string> {
  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const result = await generateReply(
      provider,
      systemPrompt,
      history,
      llmTools,
      providerOptions,
      mode,
      handlers,
    );

    history.push(result.assistantMessage);

    if (!enableToolLoop || result.toolCalls.length === 0) {
      return result.content;
    }

    await executeToolCalls(tools, result.toolCalls, history, handlers);
  }

  const lastAssistant = [...history]
    .reverse()
    .find((message): message is Extract<ChatMessage, { role: "assistant" }> =>
      message.role === "assistant",
    );

  return lastAssistant?.content ?? "";
}

async function executeToolCalls(
  tools: ToolDefinition[],
  toolCalls: ToolCall[],
  history: ChatMessage[],
  handlers?: StreamHandlers,
): Promise<void> {
  for (const call of toolCalls) {
    handlers?.onToolStart?.({
      toolCallId: call.id,
      tool: call.name,
      input: call.arguments,
    });

    const result = await executeToolCall(tools, call);

    handlers?.onToolEnd?.({
      toolCallId: call.id,
      tool: call.name,
      result,
    });

    history.push({
      role: "tool",
      toolCallId: call.id,
      name: call.name,
      content: serializeToolResult(result),
    });
  }
}

async function generateReply(
  provider: ProviderClient,
  systemPrompt: string,
  history: ChatMessage[],
  tools: ReturnType<typeof toLlmToolDefinitions> | undefined,
  providerOptions: { webSearch?: boolean } | undefined,
  mode: "send" | "stream",
  handlers?: StreamHandlers,
) {
  const input = {
    system: systemPrompt,
    messages: history,
    tools,
    providerOptions,
  };

  if (mode === "stream" && handlers) {
    return provider.streamChat(input, {
      onChunk: handlers.onChunk,
      onToolStart: handlers.onToolStart,
      onToolEnd: handlers.onToolEnd,
    });
  }

  return provider.generateChat(input);
}

export function getLastUserMessage(history: readonly ChatMessage[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];

    if (message?.role === "user" && message.content.trim()) {
      return message.content.trim();
    }
  }

  return null;
}
