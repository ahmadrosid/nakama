import type {
  ChatCompletionResult,
  ChatMessage,
  CustomModelEntry,
  GenerateChatInput,
  GenerateTextInput,
  GenerateTextResult,
  LlmToolDefinition,
  ProviderChatOptions,
  ProviderClient,
  ProviderName,
  StreamChatHandlers,
  ToolCall,
} from "@nakama/core";
import {
  messagesIncludeUserDocuments,
  messagesIncludeUserImages,
  toOpenAIChatUserContent,
} from "@nakama/core";
import {
  buildChatCompletionResult,
  extractOpenAITokenUsage,
  normalizeThinkingEffort,
  notifyToolInputDelta,
  parseJsonRecord,
  readSseEvents,
  sanitizeToolCallHistory,
} from "../shared";
import { generateOpenAIResponsesChat } from "./responses";
import {
  openAIModelRejectsChatToolsWithReasoning,
  openAIModelRequiresResponsesApi,
  openAIModelSupportsThinking,
} from "./thinking";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface OpenAIProviderOptions {
  apiKey: string;
  baseUrl?: string;
  customModels?: CustomModelEntry[];
  extraHeaders?: Record<string, string>;
  model?: string;
  providerName?: ProviderName;
}

interface OpenAIClientConfig {
  apiKey: string;
  baseUrl: string;
  extraHeaders: Record<string, string>;
  label: string;
  providerName: ProviderName;
}

export function createOpenAIProvider(
  options: OpenAIProviderOptions
): ProviderClient {
  const model = options.model ?? "gpt-5.4";
  const client: OpenAIClientConfig = {
    apiKey: options.apiKey,
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_OPENAI_BASE_URL),
    extraHeaders: options.extraHeaders ?? {},
    label: providerLabel(options.providerName ?? "openai"),
    providerName: options.providerName ?? "openai",
  };
  const useResponsesApi =
    client.providerName === "openai" &&
    client.baseUrl === DEFAULT_OPENAI_BASE_URL;
  const customModels = options.customModels;

  return {
    generateChat(input: GenerateChatInput) {
      if (useResponsesApi && usesResponsesApi(input, model, customModels)) {
        return generateOpenAIResponsesChat({
          apiKey: options.apiKey,
          customModels,
          input,
          model,
          stream: false,
        });
      }

      return requestChatCompletion(client, {
        messages: input.messages,
        model,
        signal: input.signal,
        system: input.system,
        thinking: input.providerOptions?.thinking,
        tools: input.tools,
      });
    },
    generateText(input: GenerateTextInput) {
      const useJson = (input.format ?? "json") === "json";
      const system = useJson
        ? input.system
        : `${input.system}\n\nReturn only the requested text. No JSON, keys, labels, markdown fences, or surrounding quotes.`;

      return requestCompletion(client, {
        messages: [
          { content: system, role: "system" },
          { content: input.prompt, role: "user" },
        ],
        model,
        responseFormat: useJson ? { type: "json_object" } : undefined,
      });
    },
    name: client.providerName,
    streamChat(input: GenerateChatInput, handlers: StreamChatHandlers) {
      if (useResponsesApi && usesResponsesApi(input, model, customModels)) {
        return generateOpenAIResponsesChat({
          apiKey: options.apiKey,
          customModels,
          handlers,
          input,
          model,
          stream: true,
        });
      }

      return streamChatCompletion(client, {
        handlers,
        messages: input.messages,
        model,
        signal: input.signal,
        system: input.system,
        thinking: input.providerOptions?.thinking,
        tools: input.tools,
      });
    },
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function providerLabel(providerName: ProviderName): string {
  if (providerName === "anthropic") {
    return "Anthropic";
  }

  if (providerName === "opencode_go") {
    return "OpenCode Go";
  }

  if (providerName === "deepseek") {
    return "DeepSeek";
  }

  return "OpenAI";
}

function chatCompletionsUrl(client: OpenAIClientConfig): string {
  return `${client.baseUrl}/chat/completions`;
}

function buildRequestHeaders(
  client: OpenAIClientConfig
): Record<string, string> {
  return {
    Authorization: `Bearer ${client.apiKey}`,
    "Content-Type": "application/json",
    ...client.extraHeaders,
  };
}

function usesResponsesApi(
  input: GenerateChatInput,
  model: string,
  customModels?: CustomModelEntry[]
): boolean {
  if (openAIModelRequiresResponsesApi(model)) {
    return true;
  }

  if (messagesIncludeUserDocuments(input.messages)) {
    return true;
  }

  // gpt-5.4+ reject tools + reasoning_effort on chat/completions; Responses supports both.
  if (
    (input.tools?.length ?? 0) > 0 &&
    (openAIModelRejectsChatToolsWithReasoning(model) ||
      openAIModelSupportsThinking(model, customModels))
  ) {
    return true;
  }

  if (
    input.providerOptions?.thinking?.enabled &&
    openAIModelSupportsThinking(model, customModels)
  ) {
    return true;
  }

  return (
    Boolean(input.providerOptions?.webSearch) &&
    !messagesIncludeUserImages(input.messages)
  );
}

type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | Array<Record<string, unknown>> }
  | {
      role: "assistant";
      content: string | null;
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export async function toOpenAIMessages(
  system: string,
  messages: ChatMessage[],
  provider: ProviderName = "openai"
): Promise<OpenAIMessage[]> {
  const result: OpenAIMessage[] = [{ content: system, role: "system" }];

  for (const message of sanitizeToolCallHistory(messages)) {
    result.push(await toOpenAIMessage(message, provider));
  }

  return result;
}

async function toOpenAIMessage(
  message: ChatMessage,
  provider: ProviderName
): Promise<OpenAIMessage> {
  if (message.role === "user") {
    return {
      content: (await toOpenAIChatUserContent(message.content, provider)) as
        | string
        | Array<Record<string, unknown>>,
      role: "user",
    };
  }

  if (message.role === "assistant") {
    return toOpenAIAssistantMessage(message);
  }

  return {
    content: message.content,
    role: "tool",
    tool_call_id: message.toolCallId,
  };
}

function toOpenAIAssistantMessage(
  message: Extract<ChatMessage, { role: "assistant" }>
): Extract<OpenAIMessage, { role: "assistant" }> {
  const thinking = message.thinking?.trim();

  return {
    content: message.content || null,
    role: "assistant",
    ...(thinking ? { reasoning_content: thinking } : {}),
    ...(message.toolCalls?.length
      ? { tool_calls: toOpenAIAssistantToolCalls(message.toolCalls) }
      : {}),
  };
}

function toOpenAIAssistantToolCalls(toolCalls: ToolCall[]) {
  return toolCalls.map((call) => ({
    function: {
      arguments: JSON.stringify(call.arguments),
      name: call.name,
    },
    id: call.id,
    type: "function" as const,
  }));
}

export function toOpenAITools(tools: LlmToolDefinition[] | undefined) {
  if (!tools?.length) {
    return;
  }

  return tools.map((tool) => ({
    function: {
      description: tool.description,
      name: tool.name,
      parameters: tool.parameters,
    },
    type: "function" as const,
  }));
}

export function parseOpenAIToolCalls(
  toolCalls:
    | Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>
    | undefined
): ToolCall[] {
  if (!toolCalls?.length) {
    return [];
  }

  return toolCalls.flatMap((call) => {
    const name = call.function?.name?.trim();
    const id = call.id?.trim();

    if (!(name && id)) {
      return [];
    }

    return [
      {
        arguments: parseJsonRecord(call.function?.arguments ?? "{}"),
        id,
        name,
      },
    ];
  });
}

async function buildChatCompletionRequestBody(options: {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: LlmToolDefinition[];
  stream?: boolean;
  streamOptions?: { includeUsage: boolean };
  provider?: ProviderName;
  thinking?: ProviderChatOptions["thinking"];
}) {
  const hasTools = Boolean(options.tools?.length);
  const provider = options.provider ?? "openai";

  return {
    model: options.model,
    ...(options.stream ? { stream: true } : {}),
    ...(options.streamOptions
      ? {
          stream_options: { include_usage: options.streamOptions.includeUsage },
        }
      : {}),
    messages: await toOpenAIMessages(
      options.system,
      options.messages,
      provider
    ),
    ...(provider === "deepseek"
      ? buildDeepSeekThinkingBody(options.thinking)
      : {}),
    ...(hasTools
      ? {
          tool_choice: "auto",
          tools: toOpenAITools(options.tools),
          // Safety net if a caller still hits chat/completions for gpt-5.4+.
          ...(openAIModelRejectsChatToolsWithReasoning(options.model)
            ? { reasoning_effort: "none" }
            : {}),
        }
      : {}),
  };
}

function buildDeepSeekThinkingBody(
  thinking: ProviderChatOptions["thinking"] | undefined
) {
  if (thinking?.enabled === false) {
    return { thinking: { type: "disabled" as const } };
  }

  if (!thinking?.enabled) {
    return {};
  }

  const effort = normalizeThinkingEffort(thinking.effort);
  // DeepSeek accepts low/high/max; map medium → high for compatibility.
  const reasoningEffort = effort === "medium" ? "high" : effort;

  return {
    reasoning_effort: reasoningEffort,
    thinking: { type: "enabled" as const },
  };
}

function readReasoningContent(
  value: unknown,
  options?: { preserveWhitespace?: boolean }
): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  const record = value as Record<string, unknown>;
  const direct =
    typeof record.reasoning_content === "string"
      ? record.reasoning_content
      : undefined;

  if (direct === undefined) {
    return;
  }

  if (options?.preserveWhitespace) {
    return direct.length > 0 ? direct : undefined;
  }

  const trimmed = direct.trim();
  return trimmed ? trimmed : undefined;
}

async function requestChatCompletion(
  client: OpenAIClientConfig,
  options: {
    model: string;
    system: string;
    messages: ChatMessage[];
    signal?: AbortSignal;
    tools?: LlmToolDefinition[];
    thinking?: ProviderChatOptions["thinking"];
  }
): Promise<ChatCompletionResult> {
  const response = await fetch(chatCompletionsUrl(client), {
    body: JSON.stringify(
      await buildChatCompletionRequestBody({
        ...options,
        provider: client.providerName,
      })
    ),
    headers: buildRequestHeaders(client),
    method: "POST",
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(
      `${client.label} request failed (${response.status}): ${await response.text()}`
    );
  }

  const payload = (await response.json()) as {
    usage?: Record<string, unknown>;
    choices?: Array<{
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };

  const message = payload.choices?.[0]?.message;
  const toolCalls = parseOpenAIToolCalls(message?.tool_calls);
  const content = message?.content ?? "";
  const thinking = readReasoningContent(message);

  if (!content.trim() && toolCalls.length === 0 && !thinking) {
    throw new Error(`${client.label} returned an empty response.`);
  }

  return buildChatCompletionResult({
    content,
    thinking,
    toolCalls,
    usage: extractOpenAITokenUsage(payload.usage),
  });
}

export * from "./responses";

async function streamChatCompletion(
  client: OpenAIClientConfig,
  options: {
    model: string;
    system: string;
    messages: ChatMessage[];
    signal?: AbortSignal;
    tools?: LlmToolDefinition[];
    thinking?: ProviderChatOptions["thinking"];
    handlers: StreamChatHandlers;
  }
): Promise<ChatCompletionResult> {
  const response = await fetch(chatCompletionsUrl(client), {
    body: JSON.stringify(
      await buildChatCompletionRequestBody({
        messages: options.messages,
        model: options.model,
        provider: client.providerName,
        stream: true,
        streamOptions: { includeUsage: true },
        system: options.system,
        thinking: options.thinking,
        tools: options.tools,
      })
    ),
    headers: buildRequestHeaders(client),
    method: "POST",
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(
      `${client.label} request failed (${response.status}): ${await response.text()}`
    );
  }

  if (!response.body) {
    throw new Error(`${client.label} returned an empty stream.`);
  }

  return readOpenAIStream(response.body, options.handlers, client.label);
}

async function requestCompletion(
  client: OpenAIClientConfig,
  options: {
    model: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    responseFormat?: { type: "json_object" };
  }
): Promise<GenerateTextResult> {
  const response = await fetch(chatCompletionsUrl(client), {
    body: JSON.stringify({
      messages: options.messages,
      model: options.model,
      ...(options.responseFormat
        ? { response_format: options.responseFormat }
        : {}),
    }),
    headers: buildRequestHeaders(client),
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `${client.label} request failed (${response.status}): ${await response.text()}`
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  const content = payload.choices?.[0]?.message?.content?.trim();
  const usage = extractOpenAITokenUsage(
    (payload as { usage?: Record<string, unknown> }).usage
  );

  if (!content) {
    throw new Error(`${client.label} returned an empty response.`);
  }

  return {
    content,
    ...(usage ? { usage } : {}),
  };
}

interface PendingToolCall {
  arguments: string;
  id: string;
  name: string;
}

function mergePendingToolCall(
  pending: Map<number, PendingToolCall>,
  toolDelta: {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }
): void {
  const index = toolDelta.index ?? 0;
  const current = pending.get(index) ?? {
    arguments: "",
    id: "",
    name: "",
  };

  if (toolDelta.id) {
    current.id = toolDelta.id;
  }

  if (toolDelta.function?.name) {
    current.name = toolDelta.function.name;
  }

  if (toolDelta.function?.arguments) {
    current.arguments += toolDelta.function.arguments;
  }

  pending.set(index, current);
}

function finalizePendingToolCalls(
  pending: Map<number, PendingToolCall>
): ToolCall[] {
  return [...pending.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, call]) => call)
    .flatMap((call) => {
      if (!(call.id && call.name)) {
        return [];
      }

      return [
        {
          arguments: parseJsonRecord(call.arguments),
          id: call.id,
          name: call.name,
        },
      ];
    });
}

async function readOpenAIStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamChatHandlers,
  label = "OpenAI"
): Promise<ChatCompletionResult> {
  let content = "";
  let thinking = "";
  let usage: ChatCompletionResult["usage"];
  const pending = new Map<number, PendingToolCall>();

  await readSseEvents(body, ({ data }) => {
    const payload = JSON.parse(data) as {
      usage?: Record<string, unknown>;
      choices?: Array<{
        delta?: {
          content?: string | null;
          reasoning_content?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };

    usage = extractOpenAITokenUsage(payload.usage) ?? usage;

    const delta = payload.choices?.[0]?.delta;

    if (delta?.content) {
      content += delta.content;
      handlers.onChunk(delta.content);
    }

    const reasoningDelta = readReasoningContent(delta, {
      preserveWhitespace: true,
    });

    if (reasoningDelta) {
      thinking += reasoningDelta;
      handlers.onThinking?.(reasoningDelta);
    }

    if (delta?.tool_calls) {
      for (const toolDelta of delta.tool_calls) {
        const argDelta = toolDelta.function?.arguments ?? "";
        mergePendingToolCall(pending, toolDelta);

        if (argDelta) {
          const current = pending.get(toolDelta.index ?? 0);

          if (current) {
            notifyToolInputDelta(handlers, current, argDelta);
          }
        }
      }
    }
  });

  const toolCalls = finalizePendingToolCalls(pending);
  const thinkingText = thinking.trim() || undefined;

  if (!content.trim() && toolCalls.length === 0 && !thinkingText) {
    throw new Error(`${label} returned an empty response.`);
  }

  return buildChatCompletionResult({
    content,
    thinking: thinkingText,
    toolCalls,
    usage,
  });
}
