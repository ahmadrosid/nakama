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

export interface AgentRequest {
  channel: AgentChannel;
  prompt: string;
}

export interface AgentDependencies {
  chatOptions?: ProviderChatOptions;
  provider?: ProviderClient;
  tools?: ToolDefinition[];
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
  type CompactionConfig,
  compactHistory,
  estimateHistoryTokens,
  providerReplaysThinking,
  usableContextTokens,
} from "./history-compaction";
import {
  canRunToolCallsInParallel,
  executeToolCall,
  serializeToolResult,
} from "./tool-loop";

const MAX_TOOL_ITERATIONS = 100;

export interface StreamHandlers {
  onChunk: (delta: string) => void;
  onSubAgentActivity?: (event: {
    parentToolCallId: string;
    label: string;
  }) => void;
  onThinking?: (delta: string) => void;
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

export interface AgentChatSession {
  clear(): void;
  compact(options?: { force?: boolean }): Promise<CompactionResponse>;
  createAutomation(prompt: string): Promise<AutomationDefinition>;
  getContextUsage(): ChatContextUsage | null;
  getHistory(): readonly ChatMessage[];
  getHistoryRevision(): number;
  send(input: SendMessageArg): Promise<string>;
  sendStream(
    input: SendMessageArg,
    handlers: StreamHandlers,
    options?: SendStreamOptions
  ): Promise<string>;
}

export interface SendStreamOptions {
  /** Cancels the turn: stops the tool loop and asks running tools to abort. */
  signal?: AbortSignal;
}

export interface ResolvePromptContextInput {
  userMessage?: string;
}

export interface AgentChatSessionOptions {
  channel?: AgentRequest["channel"];
  compaction?: CompactionConfig;
  enableToolLoop?: boolean;
  initialHistory?: ChatMessage[];
  preprocessUserContent?: (
    content: string | MessageContentPart[]
  ) => Promise<string | MessageContentPart[]>;
  rehydrateMessagesForProvider?: (
    messages: readonly ChatMessage[]
  ) => Promise<ChatMessage[]>;
  resolvePromptContext?: (
    context?: ResolvePromptContextInput
  ) => string | Promise<string>;
  soul?: boolean;
  systemPrompt?: string;
  toolContext?: ToolContext;
  tools?: ToolDefinition[];
  userContext?: string;
  userTimezone?: string;
}

export function createAgentChatSession(
  dependencies: AgentDependencies,
  harness: {
    createAutomationFromPrompt(
      request: AgentRequest,
      options?: { tools?: ToolDefinition[] }
    ): Promise<AutomationDefinition>;
  },
  options: AgentChatSessionOptions = {}
): AgentChatSession {
  const channel = options.channel ?? "cli";
  const tools = options.tools ?? dependencies.tools ?? [];
  const enableToolLoop = options.enableToolLoop ?? tools.length > 0;
  const systemPrompt = buildChatSystemPrompt(tools, {
    basePrompt: options.systemPrompt,
    channel,
    enableToolLoop,
    hasDocumentAttachments: messagesIncludeUserDocuments(
      options.initialHistory ?? []
    ),
    soul: options.soul,
    userContext: options.userContext,
    userTimezone: options.userTimezone,
  });
  // Bytes this session's optimiser kept out of the context. Session scope on
  // purpose: the chip beside it reports this conversation, not the org, and
  // showing an org total there would be read as this chat's saving.
  let bytesKeptOut = 0;
  // The denominator is every byte the handled tools produced this session,
  // including calls where nothing was removed. Dividing only by the optimised
  // calls would report a percentage of a set chosen after the fact.
  let bytesProduced = 0;
  const callerRecord = options.toolContext?.recordToolOutputSavings;
  const callerTurnUsage = options.toolContext?.recordTurnUsage;
  const toolContext: ToolContext = {
    ...options.toolContext,
    recordToolOutputSavings: (saving) => {
      bytesKeptOut += Math.max(0, saving.bytesIn - saving.bytesOut);
      bytesProduced += saving.bytesIn;
      callerRecord?.(saving);
    },
    // The arm is session state, and the conversation loop is a module-level
    // function that cannot see it, so it is filled in here and the loop's own
    // value is ignored.
    recordTurnUsage: (turn) =>
      callerTurnUsage?.({ ...turn, optimized: bytesKeptOut > 0 }),
  };
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
    source: ChatContextUsage["source"]
  ): ChatContextUsage | null {
    if (!options.compaction) {
      return null;
    }

    return {
      // Reported only once an optimiser has actually removed something in this
      // session, so the chip stays silent rather than announcing a feature.
      bytesKeptOut: bytesKeptOut > 0 ? bytesKeptOut : undefined,
      bytesProduced: bytesKeptOut > 0 ? bytesProduced : undefined,
      contextWindow: options.compaction.contextWindow,
      source,
      usableContextTokens: usableContextTokens(options.compaction),
      usedTokens,
    };
  }

  function rememberContextUsage(
    usedTokens: number,
    source: ChatContextUsage["source"]
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
      dependencies.provider
        ? providerReplaysThinking(dependencies.provider.name)
        : true
    );

    return buildContextUsage(usedTokens, "estimate");
  }

  async function runCompaction(force: boolean): Promise<CompactionResponse> {
    if (!(dependencies.provider && options.compaction)) {
      return {
        action: "none",
        messagesAfter: history.length,
        messagesBefore: history.length,
      };
    }

    const { localTools } = partitionTools(tools);
    const llmTools =
      options.enableToolLoop !== false && localTools.length > 0
        ? toLlmToolDefinitions(localTools)
        : undefined;
    const result = await compactHistory({
      compaction: options.compaction,
      force,
      history,
      provider: dependencies.provider,
      systemPrompt,
      tools: llmTools,
    });

    if (result.action !== "none") {
      bumpHistoryRevision();
    }

    return result;
  }

  return {
    clear() {
      history.length = 0;
      lastContextUsage = null;
      bumpHistoryRevision();
    },
    compact(options) {
      return runCompaction(options?.force ?? false);
    },
    createAutomation(prompt) {
      return harness.createAutomationFromPrompt({ channel, prompt }, { tools });
    },
    getContextUsage() {
      return lastContextUsage ?? estimateCurrentContextUsage();
    },
    getHistory() {
      return history;
    },
    getHistoryRevision() {
      return historyRevision;
    },
    async send(input) {
      return sendMessage(
        dependencies,
        tools,
        systemPrompt,
        history,
        resolveSendInput(input),
        "send",
        {
          enableToolLoop,
          onContextUsage: rememberContextUsage,
          preprocessUserContent: options.preprocessUserContent,
          rehydrateMessagesForProvider: options.rehydrateMessagesForProvider,
          resolvePromptContext: options.resolvePromptContext,
          runCompaction,
          toolContext,
        }
      );
    },
    async sendStream(input, handlers, streamOptions) {
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
          onContextUsage: rememberContextUsage,
          preprocessUserContent: options.preprocessUserContent,
          rehydrateMessagesForProvider: options.rehydrateMessagesForProvider,
          resolvePromptContext: options.resolvePromptContext,
          runCompaction,
          signal: streamOptions?.signal,
          toolContext,
        }
      );
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
      source: ChatContextUsage["source"]
    ) => void;
    resolvePromptContext?: (
      context?: ResolvePromptContextInput
    ) => string | Promise<string>;
    preprocessUserContent?: (
      content: string | MessageContentPart[]
    ) => Promise<string | MessageContentPart[]>;
    rehydrateMessagesForProvider?: (
      messages: readonly ChatMessage[]
    ) => Promise<ChatMessage[]>;
    signal?: AbortSignal;
  }
): Promise<string> {
  let userContent = normalizeUserContent(
    input.message,
    input.images,
    input.documents
  );

  if (options.preprocessUserContent) {
    userContent = await options.preprocessUserContent(userContent);
  }

  const userMessage = getUserMessageText(userContent);
  history.push({ content: userContent, role: "user" });
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

    history.push({ content: reply, role: "assistant" });
    return reply;
  }

  const { localTools, hasWebSearch } = partitionTools(tools);
  const enableTools =
    options.enableToolLoop && (localTools.length > 0 || hasWebSearch);
  const llmTools =
    enableTools && localTools.length > 0
      ? toLlmToolDefinitions(localTools)
      : undefined;
  const providerOptions = buildProviderOptions(dependencies, {
    multimodalTurn,
    webSearch:
      enableTools &&
      hasWebSearch &&
      dependencies.provider.name !== "openrouter" &&
      !(dependencies.provider.name === "gemini" && localTools.length > 0) &&
      !multimodalTurn,
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
  const baseToolContext =
    input.clientOrigin?.trim() && options.toolContext
      ? { ...options.toolContext, clientOrigin: input.clientOrigin.trim() }
      : input.clientOrigin?.trim()
        ? { clientOrigin: input.clientOrigin.trim() }
        : options.toolContext;
  const effectiveToolContext = options.signal
    ? { ...baseToolContext, signal: options.signal }
    : baseToolContext;

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
      options.signal
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
    messages: readonly ChatMessage[]
  ) => Promise<ChatMessage[]>,
  onContextUsage?: (
    usedTokens: number,
    source: ChatContextUsage["source"]
  ) => void,
  signal?: AbortSignal
): Promise<string> {
  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    signal?.throwIfAborted();

    const result = await generateReply(
      provider,
      systemPrompt,
      history,
      llmTools,
      providerOptions,
      mode,
      handlers,
      rehydrateMessagesForProvider,
      signal
    );

    const usedTokens =
      result.usage?.inputTokens ??
      estimateHistoryTokens(
        history,
        `${systemPrompt}\n\nToday is ${formatCurrentDate()}.`,
        llmTools,
        providerReplaysThinking(provider.name)
      );
    onContextUsage?.(
      usedTokens,
      result.usage && !result.usage.estimated ? "provider" : "estimate"
    );

    // The arm is what the optimiser did in this session, not what a setting
    // says: a session where nothing was ever shortened belongs in the control
    // arm even with the feature switched on, or the comparison flatters itself.
    try {
      toolContext.recordTurnUsage?.({
        estimated: Boolean(result.usage?.estimated ?? !result.usage),
        inputTokens: result.usage?.inputTokens ?? 0,
        // Overwritten by the session wrapper, which is the only scope that
        // knows whether anything was shortened.
        optimized: false,
        outputTokens: result.usage?.outputTokens ?? 0,
      });
    } catch {
      // never let accounting break a turn
    }

    // Backstop for providers that ignore the signal. The in-flight request is
    // aborted through GenerateChatInput.signal; this only catches the case where
    // it returned anyway, so a cancelled turn leaves no half-written assistant
    // message and never starts another tool batch.
    signal?.throwIfAborted();

    history.push(result.assistantMessage);

    if (!enableToolLoop || result.toolCalls.length === 0) {
      return result.content;
    }

    await executeToolCalls(
      tools,
      result.toolCalls,
      history,
      handlers,
      toolContext
    );
  }

  const lastAssistant = [...history]
    .reverse()
    .find(
      (message): message is Extract<ChatMessage, { role: "assistant" }> =>
        message.role === "assistant"
    );

  return lastAssistant?.content ?? "";
}

async function executeToolCalls(
  tools: ToolDefinition[],
  toolCalls: ToolCall[],
  history: ChatMessage[],
  handlers?: StreamHandlers,
  toolContext: ToolContext = {}
): Promise<void> {
  const contextForCall = (call: ToolCall): ToolContext => {
    if (!handlers?.onSubAgentActivity || call.name !== "sub_agent") {
      return toolContext;
    }

    return {
      ...toolContext,
      emitSubAgentActivity: (label) =>
        handlers.onSubAgentActivity?.({
          label,
          parentToolCallId: call.id,
        }),
    };
  };

  if (canRunToolCallsInParallel(tools, toolCalls)) {
    const results = await Promise.all(
      toolCalls.map(async (call) => {
        handlers?.onToolStart?.({
          input: call.arguments,
          tool: call.name,
          toolCallId: call.id,
        });

        const result = await executeToolCall(tools, call, contextForCall(call));

        handlers?.onToolEnd?.({
          result,
          tool: call.name,
          toolCallId: call.id,
        });

        return { call, result };
      })
    );

    const resultsByCallId = new Map(
      results.map((entry) => [entry.call.id, entry.result])
    );

    for (const call of toolCalls) {
      history.push({
        content: serializeToolResult(resultsByCallId.get(call.id)),
        name: call.name,
        role: "tool",
        toolCallId: call.id,
      });
    }

    return;
  }

  for (const call of toolCalls) {
    handlers?.onToolStart?.({
      input: call.arguments,
      tool: call.name,
      toolCallId: call.id,
    });

    const result = await executeToolCall(tools, call, contextForCall(call));

    handlers?.onToolEnd?.({
      result,
      tool: call.name,
      toolCallId: call.id,
    });

    history.push({
      content: serializeToolResult(result),
      name: call.name,
      role: "tool",
      toolCallId: call.id,
    });
  }
}

function formatCurrentDate(): string {
  return new Date().toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
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
    messages: readonly ChatMessage[]
  ) => Promise<ChatMessage[]>,
  signal?: AbortSignal
) {
  const dateLine = `Today is ${formatCurrentDate()}.`;
  const messages =
    rehydrateMessagesForProvider === undefined
      ? history
      : await rehydrateMessagesForProvider(history);
  const input = {
    messages,
    providerOptions,
    signal,
    system: `${systemPrompt}\n\n${dateLine}`,
    tools,
  };

  if (mode === "stream" && handlers) {
    return provider.streamChat(input, {
      onChunk: handlers.onChunk,
      onThinking: handlers.onThinking,
      onToolEnd: handlers.onToolEnd,
      onToolInputDelta: handlers.onToolInputDelta,
      onToolStart: handlers.onToolStart,
    });
  }

  return provider.generateChat(input);
}

function buildProviderOptions(
  dependencies: AgentDependencies,
  options: { webSearch: boolean; multimodalTurn: boolean }
): ProviderChatOptions | undefined {
  const base = dependencies.chatOptions;
  const thinking =
    options.multimodalTurn || !base?.thinking?.enabled
      ? undefined
      : base.thinking;
  const webSearch = options.webSearch ? true : undefined;

  if (!(webSearch || thinking)) {
    return;
  }

  return {
    ...(webSearch ? { webSearch: true } : {}),
    ...(thinking ? { thinking } : {}),
  };
}
