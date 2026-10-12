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
  ThinkingEffort,
  ToolCall,
} from "@nakama/core";
import {
  fetchWithoutIdleTimeout,
  messagesIncludeUserDocuments,
  messagesIncludeUserImages,
  toOpenAIChatUserContent,
} from "@nakama/core";
import { z } from "zod";
import {
  buildChatCompletionResult,
  extractOpenAITokenUsage,
  finalizePendingToolCalls,
  formatHttpErrorBody,
  mergePendingToolCall,
  normalizeThinkingEffort,
  notifyToolInputDelta,
  type PendingToolCall,
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

  if (providerName === "doubao") {
    return "Doubao (Volcengine)";
  }

  if (providerName === "together") {
    return "Together AI";
  }

  if (providerName === "xiaomi") {
    return "Xiaomi MiMo";
  }

  if (providerName === "vercel_ai_gateway") {
    return "Vercel AI Gateway";
  }

  if (providerName === "mistral") {
    return "Mistral";
  }

  if (providerName === "qwen") {
    return "Qwen (DashScope)";
  }

  if (providerName === "qwen_cn") {
    return "Qwen (DashScope CN)";
  }

  if (providerName === "perplexity") {
    return "Perplexity";
  }

  return "OpenAI";
}

function chatCompletionsUrl(client: OpenAIClientConfig): string {
  return `${client.baseUrl}/chat/completions`;
}

function buildRequestHeaders(client: OpenAIClientConfig) {
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
    (model.trim().toLowerCase().startsWith("gpt-6.1-sol") ||
      openAIModelRejectsChatToolsWithReasoning(model) ||
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

type OpenAIUserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_file"; file_data: string; filename: string };

type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | OpenAIUserContentPart[] }
  | {
      role: "assistant";
      content: string | null;
      reasoning_content?: string;
      reasoning_details?: unknown[];
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenAIChatCompletionRequest = {
  model: string;
  messages: OpenAIMessage[];
  stream?: true;
  stream_options?: { include_usage: boolean };
  thinking?: { type: "disabled" | "enabled" };
  reasoning_effort?: ThinkingEffort | "none";
  enable_thinking?: boolean;
  reasoning?: { effort: ThinkingEffort; enabled: true };
  tool_choice?: "auto";
  tools?: ReturnType<typeof toOpenAITools>;
};

type OpenAITextRequestBody = {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model: string;
  response_format?: { type: "json_object" };
};

const openAICompletionPayloadSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullable().optional(),
            reasoning: z.string().nullable().optional(),
            reasoning_content: z.string().nullable().optional(),
            tool_calls: z
              .array(
                z.object({
                  function: z
                    .object({
                      arguments: z.string().optional(),
                      name: z.string().optional(),
                    })
                    .optional(),
                  id: z.string().optional(),
                  index: z.number().optional(),
                })
              )
              .optional(),
          })
          .optional(),
        message: z
          .object({
            content: z.string().nullable().optional(),
            reasoning: z.string().nullable().optional(),
            reasoning_content: z.string().nullable().optional(),
            tool_calls: z
              .array(
                z.object({
                  function: z
                    .object({
                      arguments: z.string().optional(),
                      name: z.string().optional(),
                    })
                    .optional(),
                  id: z.string().optional(),
                })
              )
              .optional(),
          })
          .optional(),
      })
    )
    .optional(),
  citations: z
    .array(z.string())
    .nullish()
    .transform((citations) => citations ?? undefined),
  usage: z
    .object({
      completion_tokens: z.number().optional(),
      prompt_tokens: z.number().optional(),
      prompt_tokens_details: z
        .object({ cached_tokens: z.number().optional() })
        .optional(),
      total_tokens: z.number().optional(),
    })
    .nullish(),
});

type OpenAIReasoningValue = {
  reasoning?: string | null;
  reasoning_content?: string | null;
};

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
    const content = await toOpenAIChatUserContent(message.content, provider);

    return {
      // SAFETY: Core's converter emits text, image URL, or input file parts.
      content: content as string | OpenAIUserContentPart[],
      role: "user",
    };
  }

  if (message.role === "assistant") {
    return toOpenAIAssistantMessage(message, provider);
  }

  return {
    content: message.content,
    role: "tool",
    tool_call_id: message.toolCallId,
  };
}

function toOpenAIAssistantMessage(
  message: Extract<ChatMessage, { role: "assistant" }>,
  provider: ProviderName
): Extract<OpenAIMessage, { role: "assistant" }> {
  const thinking = message.thinking?.trim();

  const result: Extract<OpenAIMessage, { role: "assistant" }> = {
    content: message.content || null,
    role: "assistant",
  };

  if (thinking && !(provider === "netra" && message.providerContent?.length)) {
    result.reasoning_content = thinking;
  }

  if (provider === "netra" && message.providerContent?.length) {
    result.reasoning_details = message.providerContent;
  }

  if (message.toolCalls?.length) {
    result.tool_calls = toOpenAIAssistantToolCalls(message.toolCalls);
  }

  return result;
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
}): Promise<OpenAIChatCompletionRequest> {
  const provider = options.provider ?? "openai";
  const hasTools = provider !== "perplexity" && Boolean(options.tools?.length);

  if (
    hasTools &&
    (options.model.trim().toLowerCase().startsWith("gpt-6-astra") ||
      (provider === "openai" &&
        options.model.trim().toLowerCase().startsWith("gpt-6.1-sol")))
  ) {
    throw new Error(`${options.model} requires the Responses API for tools.`);
  }

  const body: OpenAIChatCompletionRequest = {
    messages: await toOpenAIMessages(
      options.system,
      options.messages,
      provider
    ),
    model: options.model,
  };

  if (options.stream) {
    body.stream = true;
  }

  if (options.streamOptions && provider !== "perplexity") {
    body.stream_options = {
      include_usage: options.streamOptions.includeUsage,
    };
  }

  if (provider === "deepseek") {
    const thinkingBody = buildDeepSeekThinkingBody(options.thinking);

    if (thinkingBody.thinking) {
      body.thinking = thinkingBody.thinking;
    }

    if (thinkingBody.reasoning_effort) {
      body.reasoning_effort = thinkingBody.reasoning_effort;
    }
  }

  if (provider === "xiaomi") {
    body.thinking = buildXiaomiThinkingBody(options.thinking).thinking;
  }

  if (provider === "qwen" || provider === "qwen_cn") {
    body.enable_thinking = Boolean(options.thinking?.enabled);
  }

  if (provider === "doubao") {
    body.thinking = buildDoubaoThinkingBody(options.thinking).thinking;
  }

  if (provider === "vercel_ai_gateway" && options.thinking?.enabled) {
    body.reasoning = {
      effort: normalizeThinkingEffort(options.thinking.effort),
      enabled: true,
    };
  }

  if (provider === "perplexity" && options.thinking?.enabled) {
    body.reasoning_effort = normalizeThinkingEffort(options.thinking.effort);
  }

  if (hasTools) {
    body.tool_choice = "auto";
    body.tools = toOpenAITools(options.tools);

    // Safety net if a caller still hits chat/completions for gpt-5.4+.
    if (openAIModelRejectsChatToolsWithReasoning(options.model)) {
      body.reasoning_effort = "none";
    }
  }

  return body;
}

function formatPerplexityCitations(
  citationsInput: string[] | undefined
): string {
  const citations: string[] = [];
  const seen = new Set<string>();

  for (const citation of citationsInput ?? []) {
    try {
      const url = new URL(citation);

      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        !seen.has(url.href)
      ) {
        seen.add(url.href);
        citations.push(url.href.replaceAll(">", "%3E"));
      }
    } catch {
      // Ignore malformed citation metadata without dropping the answer.
    }
  }

  if (citations.length === 0) {
    return "";
  }

  return `\n\nSources:\n${citations
    .map((citation, index) => `${index + 1}. <${citation}>`)
    .join("\n")}`;
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

/** MiMo: `thinking.type` only. API defaults to enabled — opt out unless UI asks. */
function buildXiaomiThinkingBody(
  thinking: ProviderChatOptions["thinking"] | undefined
) {
  if (thinking?.enabled) {
    return { thinking: { type: "enabled" as const } };
  }

  return { thinking: { type: "disabled" as const } };
}

/** Ark Seed: `thinking.type` only. Default is on for many Seed models — opt out unless UI enables. */
function buildDoubaoThinkingBody(
  thinking: ProviderChatOptions["thinking"] | undefined
) {
  if (thinking?.enabled) {
    return { thinking: { type: "enabled" as const } };
  }

  return { thinking: { type: "disabled" as const } };
}

function readReasoningContent(
  value: OpenAIReasoningValue | undefined,
  options?: { preserveWhitespace?: boolean }
): string | undefined {
  const direct = value?.reasoning_content ?? value?.reasoning ?? undefined;

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
  const response = await fetchWithoutIdleTimeout(chatCompletionsUrl(client), {
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
      formatHttpErrorBody(client.label, response.status, await response.text())
    );
  }

  const payload = openAICompletionPayloadSchema.parse(await response.json());

  const message = payload.choices?.[0]?.message;
  const toolCalls = parseOpenAIToolCalls(message?.tool_calls);

  const citationText =
    client.providerName === "perplexity"
      ? formatPerplexityCitations(payload.citations)
      : "";

  const content = `${message?.content ?? ""}${citationText}`;
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
  const response = await fetchWithoutIdleTimeout(chatCompletionsUrl(client), {
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
      formatHttpErrorBody(client.label, response.status, await response.text())
    );
  }

  if (!response.body) {
    throw new Error(`${client.label} returned an empty stream.`);
  }

  return readOpenAIStream(
    response.body,
    options.handlers,
    client.label,
    client.providerName
  );
}

async function requestCompletion(
  client: OpenAIClientConfig,
  options: {
    model: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    responseFormat?: { type: "json_object" };
  }
): Promise<GenerateTextResult> {
  const requestBody: OpenAITextRequestBody = {
    messages: options.messages,
    model: options.model,
  };

  if (options.responseFormat && client.providerName !== "perplexity") {
    requestBody.response_format = options.responseFormat;
  }

  const response = await fetchWithoutIdleTimeout(chatCompletionsUrl(client), {
    body: JSON.stringify(requestBody),
    headers: buildRequestHeaders(client),
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      formatHttpErrorBody(client.label, response.status, await response.text())
    );
  }

  // SAFETY: OpenAI Chat Completions returns the documented choices and usage fields.
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: unknown;
  };

  const content = payload.choices?.[0]?.message?.content?.trim();

  const usage = extractOpenAITokenUsage(payload.usage);

  if (!content) {
    throw new Error(`${client.label} returned an empty response.`);
  }

  const result: GenerateTextResult = { content };

  if (usage) {
    result.usage = usage;
  }

  return result;
}

async function readOpenAIStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamChatHandlers,
  label = "OpenAI",
  provider: ProviderName = "openai"
): Promise<ChatCompletionResult> {
  let content = "";
  let thinking = "";
  let usage: ChatCompletionResult["usage"];
  let citations: string[] | undefined;
  const pending = new Map<number, PendingToolCall>();

  await readSseEvents(body, ({ data }) => {
    const payload = openAICompletionPayloadSchema.parse(JSON.parse(data));

    usage = extractOpenAITokenUsage(payload.usage) ?? usage;
    citations = payload.citations ?? citations;

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

  const citationText =
    provider === "perplexity" ? formatPerplexityCitations(citations) : "";

  if (citationText) {
    content += citationText;
    handlers.onChunk(citationText);
  }

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
