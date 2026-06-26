import type {
  AgentChannel,
  AutomationDefinition,
  ChatMessage,
  CompactionResponse,
  MessageContentPart,
  ProviderChatOptions,
  ProviderClient,
  SendMessageInput,
  ToolCall,
  ToolContext,
  ToolDefinition,
} from "@tinyclaw/core";

export interface AgentRequest {
  prompt: string;
  channel: AgentChannel;
}

export interface AgentDependencies {
  provider?: ProviderClient;
  tools?: ToolDefinition[];
  chatOptions?: ProviderChatOptions;
}
import {
  getUserMessageText,
  messageContentHasDocuments,
  messageContentHasImages,
  messagesIncludeUserDocuments,
  messagesIncludeUserImages,
  normalizeUserContent,
  partitionTools,
  toLlmToolDefinitions,
} from "@tinyclaw/core";
import { buildChatSystemPrompt } from "./chat-prompt";
import {
  compactHistory,
  type CompactionConfig,
} from "./history-compaction";
import { executeToolCall, serializeToolResult } from "./tool-loop";

const MAX_TOOL_ITERATIONS = 100;

export interface StreamHandlers {
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

export type SendMessageArg = string | SendMessageInput;

export interface AgentChatSession {
  send(input: SendMessageArg): Promise<string>;
  sendStream(input: SendMessageArg, handlers: StreamHandlers): Promise<string>;
  clear(): void;
  compact(options?: { force?: boolean }): Promise<CompactionResponse>;
  getHistory(): readonly ChatMessage[];
  getHistoryRevision(): number;
  createAutomation(prompt: string): Promise<AutomationDefinition>;
}

export interface ResolvePromptContextInput {
  userMessage?: string;
}

export interface AgentChatSessionOptions {
  channel?: AgentRequest["channel"];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  userContext?: string;
  enableToolLoop?: boolean;
  soul?: boolean;
  initialHistory?: ChatMessage[];
  toolContext?: ToolContext;
  userTimezone?: string;
  compaction?: CompactionConfig;
  resolvePromptContext?: (
    context?: ResolvePromptContextInput,
  ) => string | Promise<string>;
  preprocessUserContent?: (
    content: string | MessageContentPart[],
  ) => Promise<string | MessageContentPart[]>;
  rehydrateMessagesForProvider?: (
    messages: readonly ChatMessage[],
  ) => Promise<ChatMessage[]>;
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
    userContext: options.userContext,
    enableToolLoop,
    soul: options.soul,
    userTimezone: options.userTimezone,
    channel,
  });
  const toolContext = options.toolContext ?? {};
  const history: ChatMessage[] = options.initialHistory
    ? [...options.initialHistory]
    : [];
  let historyRevision = 0;

  function bumpHistoryRevision(): void {
    historyRevision += 1;
  }

  async function runCompaction(force: boolean): Promise<CompactionResponse> {
    if (!dependencies.provider || !options.compaction) {
      return {
        action: "none",
        messagesBefore: history.length,
        messagesAfter: history.length,
      };
    }

    const { localTools } = partitionTools(tools);
    const llmTools =
      options.enableToolLoop !== false && localTools.length > 0
        ? toLlmToolDefinitions(localTools)
        : undefined;
    const result = await compactHistory({
      history,
      provider: dependencies.provider,
      systemPrompt,
      tools: llmTools,
      compaction: options.compaction,
      force,
    });

    if (result.action !== "none") {
      bumpHistoryRevision();
    }

    return result;
  }

  return {
    async send(input) {
      return sendMessage(dependencies, tools, systemPrompt, history, resolveSendInput(input), "send", {
        enableToolLoop,
        toolContext,
        runCompaction,
        resolvePromptContext: options.resolvePromptContext,
        preprocessUserContent: options.preprocessUserContent,
        rehydrateMessagesForProvider: options.rehydrateMessagesForProvider,
      });
    },
    async sendStream(input, handlers) {
      return sendMessage(
        dependencies,
        tools,
        systemPrompt,
        history,
        resolveSendInput(input),
        "stream",
        {
          enableToolLoop,
          handlers,
          toolContext,
          runCompaction,
          resolvePromptContext: options.resolvePromptContext,
          preprocessUserContent: options.preprocessUserContent,
          rehydrateMessagesForProvider: options.rehydrateMessagesForProvider,
        },
      );
    },
    clear() {
      history.length = 0;
      bumpHistoryRevision();
    },
    compact(options) {
      return runCompaction(options?.force ?? false);
    },
    getHistory() {
      return history;
    },
    getHistoryRevision() {
      return historyRevision;
    },
    createAutomation(prompt) {
      return harness.createAutomationFromPrompt({ prompt, channel }, { tools });
    },
  };
}

function resolveSendInput(input: SendMessageArg): SendMessageInput {
  return typeof input === "string" ? { message: input } : input;
}

async function sendMessage(
  dependencies: AgentDependencies,
  tools: ToolDefinition[],
  systemPrompt: string,
  history: ChatMessage[],
  input: SendMessageInput,
  mode: "send" | "stream",
  options: {
    enableToolLoop: boolean;
    handlers?: StreamHandlers;
    toolContext?: ToolContext;
    runCompaction?: (force: boolean) => Promise<CompactionResponse>;
    resolvePromptContext?: (
      context?: ResolvePromptContextInput,
    ) => string | Promise<string>;
    preprocessUserContent?: (
      content: string | MessageContentPart[],
    ) => Promise<string | MessageContentPart[]>;
    rehydrateMessagesForProvider?: (
      messages: readonly ChatMessage[],
    ) => Promise<ChatMessage[]>;
  },
): Promise<string> {
  let userContent = normalizeUserContent(
    input.message,
    input.images,
    input.documents,
  );

  if (options.preprocessUserContent) {
    userContent = await options.preprocessUserContent(userContent);
  }

  const userMessage = getUserMessageText(userContent);
  history.push({ role: "user", content: userContent });
  const multimodalTurn =
    messageContentHasImages(userContent) ||
    messageContentHasDocuments(userContent) ||
    messagesIncludeUserImages(history) ||
    messagesIncludeUserDocuments(history);

  if (!dependencies.provider) {
    const hasAttachments = multimodalTurn;
    const reply = hasAttachments
      ? "Attachments require a configured provider. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY in Settings."
      : "I'm running in offline mode. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY to chat with me. You can still use /create to draft automations locally.";

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
  const providerOptions = buildProviderOptions(dependencies, {
    webSearch:
      enableTools &&
      hasWebSearch &&
      dependencies.provider.name !== "openrouter" &&
      !(
        dependencies.provider.name === "gemini" && localTools.length > 0
      ) &&
      !multimodalTurn,
    multimodalTurn,
  });

  if (options.runCompaction) {
    await options.runCompaction(false);
  }

  const promptContext = options.resolvePromptContext
    ? await options.resolvePromptContext({ userMessage })
    : "";
  const effectiveSystemPrompt = promptContext.trim()
    ? `${systemPrompt}\n\n${promptContext.trim()}`
    : systemPrompt;

  try {
    const reply = await runConversation(
      dependencies.provider,
      localTools,
      effectiveSystemPrompt,
      history,
      mode,
      enableTools,
      llmTools,
      providerOptions,
      options.handlers,
      options.toolContext,
      options.rehydrateMessagesForProvider,
    );

    return reply;
  } catch (error) {
    rollbackFailedSend(history);
    throw error;
  }
}

function rollbackFailedSend(history: ChatMessage[]): void {
  while (history.length > 0) {
    const last = history.at(-1);

    if (last?.role === "tool") {
      history.pop();
      continue;
    }

    if (last?.role === "assistant" && (last.toolCalls?.length ?? 0) > 0) {
      history.pop();
      continue;
    }

    if (last?.role === "user") {
      history.pop();
    }

    break;
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
  providerOptions: ProviderChatOptions | undefined,
  handlers?: StreamHandlers,
  toolContext?: ToolContext,
  rehydrateMessagesForProvider?: (
    messages: readonly ChatMessage[],
  ) => Promise<ChatMessage[]>,
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
      rehydrateMessagesForProvider,
    );

    history.push(result.assistantMessage);

    if (!enableToolLoop || result.toolCalls.length === 0) {
      return result.content;
    }

    await executeToolCalls(tools, result.toolCalls, history, handlers, toolContext);
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
  toolContext: ToolContext = {},
): Promise<void> {
  for (const call of toolCalls) {
    handlers?.onToolStart?.({
      toolCallId: call.id,
      tool: call.name,
      input: call.arguments,
    });

    const result = await executeToolCall(tools, call, toolContext);

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

function formatCurrentDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

async function generateReply(
  provider: ProviderClient,
  systemPrompt: string,
  history: ChatMessage[],
  tools: ReturnType<typeof toLlmToolDefinitions> | undefined,
  providerOptions: ProviderChatOptions | undefined,
  mode: "send" | "stream",
  handlers?: StreamHandlers,
  rehydrateMessagesForProvider?: (
    messages: readonly ChatMessage[],
  ) => Promise<ChatMessage[]>,
) {
  const dateLine = `Today is ${formatCurrentDate()}.`;
  const messages =
    rehydrateMessagesForProvider !== undefined
      ? await rehydrateMessagesForProvider(history)
      : history;
  const input = {
    system: `${systemPrompt}\n\n${dateLine}`,
    messages,
    tools,
    providerOptions,
  };

  if (mode === "stream" && handlers) {
    return provider.streamChat(input, {
      onChunk: handlers.onChunk,
      onThinking: handlers.onThinking,
      onToolStart: handlers.onToolStart,
      onToolEnd: handlers.onToolEnd,
    });
  }

  return provider.generateChat(input);
}

function buildProviderOptions(
  dependencies: AgentDependencies,
  options: { webSearch: boolean; multimodalTurn: boolean },
): ProviderChatOptions | undefined {
  const base = dependencies.chatOptions;
  const thinking =
    options.multimodalTurn || !base?.thinking?.enabled ? undefined : base.thinking;
  const webSearch = options.webSearch ? true : undefined;

  if (!webSearch && !thinking) {
    return undefined;
  }

  return {
    ...(webSearch ? { webSearch: true } : {}),
    ...(thinking ? { thinking } : {}),
  };
}
