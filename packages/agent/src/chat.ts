import type {
  AgentChannel,
  AutomationDefinition,
  ChatContextUsage,
  ChatMessage,
  CompactionResponse,
  MessageContentPart,
  ProviderChatOptions,
  ProviderClient,
  SendMessageInput,
  ToolCall,
  ToolContext,
  ToolDefinition,
} from "@nakama/core";
import { reportInvariant } from "@nakama/core/crash-report";

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
} from "@nakama/core";
import {
  buildChatSystemPrompt,
  UNTRUSTED_DOCUMENT_GUIDANCE,
} from "./chat-prompt";
import {
  compactHistory,
  estimateHistoryTokens,
  usableContextTokens,
  type CompactionConfig,
} from "./history-compaction";
import { executeToolCall, canRunToolCallsInParallel, serializeToolResult } from "./tool-loop";

const MAX_TOOL_ITERATIONS = 100;

export interface StreamHandlers {
  onChunk: (delta: string) => void;
  onThinking?: (delta: string) => void;
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
}

export type SendMessageArg = string | SendMessageInput;

export interface AgentChatSession {
  send(input: SendMessageArg): Promise<string>;
  sendStream(input: SendMessageArg, handlers: StreamHandlers): Promise<string>;
  clear(): void;
  compact(options?: { force?: boolean }): Promise<CompactionResponse>;
  getHistory(): readonly ChatMessage[];
  getHistoryRevision(): number;
  getContextUsage(): ChatContextUsage | null;
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
    hasDocumentAttachments: messagesIncludeUserDocuments(
      options.initialHistory ?? [],
    ),
  });
  const toolContext = options.toolContext ?? {};
  const history: ChatMessage[] = options.initialHistory
    ? [...options.initialHistory]
    : [];
  let historyRevision = 0;
  let lastContextUsage: ChatContextUsage | null = null;

  function bumpHistoryRevision(): void {
    historyRevision += 1;
  }

  function llmToolsForEstimate() {
    const { localTools } = partitionTools(tools);
    return enableToolLoop && localTools.length > 0
      ? toLlmToolDefinitions(localTools)
      : undefined;
  }

  function buildContextUsage(
    usedTokens: number,
    source: ChatContextUsage["source"],
  ): ChatContextUsage | null {
    if (!options.compaction) {
      return null;
    }

    return {
      usedTokens,
      usableContextTokens: usableContextTokens(options.compaction),
      contextWindow: options.compaction.contextWindow,
      source,
    };
  }

  function rememberContextUsage(
    usedTokens: number,
    source: ChatContextUsage["source"],
  ): void {
    lastContextUsage = buildContextUsage(usedTokens, source);
  }

  function estimateCurrentContextUsage(): ChatContextUsage | null {
    if (!options.compaction) {
      return null;
    }

    const dateLine = `Today is ${formatCurrentDate()}.`;
    const usedTokens = estimateHistoryTokens(
      history,
      `${systemPrompt}\n\n${dateLine}`,
      llmToolsForEstimate(),
    );

    return buildContextUsage(usedTokens, "estimate");
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
        onContextUsage: rememberContextUsage,
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
          onContextUsage: rememberContextUsage,
          resolvePromptContext: options.resolvePromptContext,
          preprocessUserContent: options.preprocessUserContent,
          rehydrateMessagesForProvider: options.rehydrateMessagesForProvider,
        },
      );
    },
    clear() {
      history.length = 0;
      lastContextUsage = null;
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
    getContextUsage() {
      return lastContextUsage ?? estimateCurrentContextUsage();
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
    onContextUsage?: (
      usedTokens: number,
      source: ChatContextUsage["source"],
    ) => void;
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
  let effectiveSystemPrompt = promptContext.trim()
    ? `${systemPrompt}\n\n${promptContext.trim()}`
    : systemPrompt;
  const hasDocumentAttachments =
    messageContentHasDocuments(userContent) ||
    messagesIncludeUserDocuments(history);
  if (
    hasDocumentAttachments &&
    !effectiveSystemPrompt.includes("untrusted document data")
  ) {
    effectiveSystemPrompt = `${effectiveSystemPrompt}\n\n${UNTRUSTED_DOCUMENT_GUIDANCE}`;
  }
  const effectiveToolContext =
    input.clientOrigin?.trim() && options.toolContext
      ? { ...options.toolContext, clientOrigin: input.clientOrigin.trim() }
      : input.clientOrigin?.trim()
        ? { clientOrigin: input.clientOrigin.trim() }
        : options.toolContext;

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
      effectiveToolContext,
      options.rehydrateMessagesForProvider,
      options.onContextUsage,
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
  onContextUsage?: (
    usedTokens: number,
    source: ChatContextUsage["source"],
  ) => void,
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

    const usedTokens =
      result.usage?.inputTokens ??
      estimateHistoryTokens(
        history,
        `${systemPrompt}\n\nToday is ${formatCurrentDate()}.`,
        llmTools,
      );
    onContextUsage?.(
      usedTokens,
      result.usage && !result.usage.estimated ? "provider" : "estimate",
    );

    history.push(result.assistantMessage);

    if (!enableToolLoop || result.toolCalls.length === 0) {
      // Only after tools actually ran. A first response that is empty can be an ordinary
      // model result; an empty one after a round of tool calls is work the user paid for
      // and never saw.
      if (iteration > 0 && !result.content.trim()) {
        void reportInvariant("agent ran tools but finished the turn with no reply", {
          source: "agent",
        });
      }

      return result.content;
    }

    await executeToolCalls(tools, result.toolCalls, history, handlers, toolContext);
  }

  // Falling out of the loop means the cap was hit, not that the model finished. The reply
  // below is a partial answer the user cannot tell apart from a complete one, so it is
  // reported rather than only returned.
  void reportInvariant(
    `agent tool loop hit the ${MAX_TOOL_ITERATIONS} iteration cap without a final answer`,
    { source: "agent" },
  );

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
  const contextForCall = (call: ToolCall): ToolContext => {
    if (!handlers?.onSubAgentActivity || call.name !== "sub_agent") {
      return toolContext;
    }

    return {
      ...toolContext,
      emitSubAgentActivity: (label) =>
        handlers.onSubAgentActivity?.({
          parentToolCallId: call.id,
          label,
        }),
    };
  };

  if (canRunToolCallsInParallel(tools, toolCalls)) {
    const results = await Promise.all(
      toolCalls.map(async (call) => {
        handlers?.onToolStart?.({
          toolCallId: call.id,
          tool: call.name,
          input: call.arguments,
        });

        const result = await executeToolCall(tools, call, contextForCall(call));

        handlers?.onToolEnd?.({
          toolCallId: call.id,
          tool: call.name,
          result,
        });

        return { call, result };
      }),
    );

    const resultsByCallId = new Map(results.map((entry) => [entry.call.id, entry.result]));

    for (const call of toolCalls) {
      history.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: serializeToolResult(resultsByCallId.get(call.id)),
      });
    }

    return;
  }

  for (const call of toolCalls) {
    handlers?.onToolStart?.({
      toolCallId: call.id,
      tool: call.name,
      input: call.arguments,
    });

    const result = await executeToolCall(tools, call, contextForCall(call));

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
      onToolInputDelta: handlers.onToolInputDelta,
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
