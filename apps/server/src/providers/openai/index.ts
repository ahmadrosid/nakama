import type {
  ChatCompletionResult,
  ChatMessage,
  CustomModelEntry,
  GenerateChatInput,
  GenerateTextResult,
  GenerateTextInput,
  LlmToolDefinition,
  ProviderClient,
  ProviderName,
  StreamChatHandlers,
  ToolCall,
} from "@nakama/core";
import { messagesIncludeUserDocuments, messagesIncludeUserImages, toOpenAIChatUserContent } from "@nakama/core";
import { generateOpenAIResponsesChat } from "./responses";
import {
  buildChatCompletionResult,
  extractOpenAITokenUsage,
  notifyToolInputDelta,
  parseJsonRecord,
  readSseEvents,
} from "../shared";
import { openAIModelSupportsThinking, openAIModelRequiresResponsesApi } from "./thinking";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface OpenAIProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  providerName?: ProviderName;
  extraHeaders?: Record<string, string>;
  customModels?: CustomModelEntry[];
}

interface OpenAIClientConfig {
  apiKey: string;
  baseUrl: string;
  providerName: ProviderName;
  extraHeaders: Record<string, string>;
  label: string;
}

export function createOpenAIProvider(
  options: OpenAIProviderOptions,
): ProviderClient {
  const model = options.model ?? "gpt-5.4";
  const client: OpenAIClientConfig = {
    apiKey: options.apiKey,
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_OPENAI_BASE_URL),
    providerName: options.providerName ?? "openai",
    extraHeaders: options.extraHeaders ?? {},
    label: providerLabel(options.providerName ?? "openai"),
  };
  const useResponsesApi = client.providerName === "openai" && client.baseUrl === DEFAULT_OPENAI_BASE_URL;
  const customModels = options.customModels;

  return {
    name: client.providerName,
    generateText(input: GenerateTextInput) {
      const useJson = (input.format ?? "json") === "json";
      const system = useJson
        ? input.system
        : `${input.system}\n\nReturn only the requested text. No JSON, keys, labels, markdown fences, or surrounding quotes.`;

      return requestCompletion(client, {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: input.prompt },
        ],
        responseFormat: useJson ? { type: "json_object" } : undefined,
      });
    },
    generateChat(input: GenerateChatInput) {
      if (useResponsesApi && usesResponsesApi(input, model, customModels)) {
        return generateOpenAIResponsesChat({
          apiKey: options.apiKey,
          model,
          input,
          stream: false,
          customModels,
        });
      }

      return requestChatCompletion(client, {
        model,
        system: input.system,
        messages: input.messages,
        tools: input.tools,
      });
    },
    streamChat(input: GenerateChatInput, handlers: StreamChatHandlers) {
      if (useResponsesApi && usesResponsesApi(input, model, customModels)) {
        return generateOpenAIResponsesChat({
          apiKey: options.apiKey,
          model,
          input,
          stream: true,
          handlers,
          customModels,
        });
      }

      return streamChatCompletion(client, {
        model,
        system: input.system,
        messages: input.messages,
        tools: input.tools,
        handlers,
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

function buildRequestHeaders(client: OpenAIClientConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${client.apiKey}`,
    "Content-Type": "application/json",
    ...client.extraHeaders,
  };
}

function usesResponsesApi(
  input: GenerateChatInput,
  model: string,
  customModels?: CustomModelEntry[],
): boolean {
  if (openAIModelRequiresResponsesApi(model)) {
    return true;
  }

  if (messagesIncludeUserDocuments(input.messages)) {
    return true;
  }

  if (
    input.providerOptions?.thinking?.enabled &&
    openAIModelSupportsThinking(model, customModels)
  ) {
    return true;
  }

  return Boolean(input.providerOptions?.webSearch) && !messagesIncludeUserImages(input.messages);
}

type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | Array<Record<string, unknown>> }
  | {
      role: "assistant";
      content: string | null;
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
  provider: ProviderName = "openai",
): Promise<OpenAIMessage[]> {
  const result: OpenAIMessage[] = [{ role: "system", content: system }];

  for (const message of messages) {
    result.push(await toOpenAIMessage(message, provider));
  }

  return result;
}

async function toOpenAIMessage(
  message: ChatMessage,
  provider: ProviderName,
): Promise<OpenAIMessage> {
  if (message.role === "user") {
    return {
      role: "user",
      content: (await toOpenAIChatUserContent(message.content, provider)) as
        | string
        | Array<Record<string, unknown>>,
    };
  }

  if (message.role === "assistant") {
    return toOpenAIAssistantMessage(message);
  }

  return {
    role: "tool",
    tool_call_id: message.toolCallId,
    content: message.content,
  };
}

function toOpenAIAssistantMessage(
  message: Extract<ChatMessage, { role: "assistant" }>,
): Extract<OpenAIMessage, { role: "assistant" }> {
  const thinking = message.thinking?.trim();

  return {
    role: "assistant",
    content: message.content || null,
    ...(thinking ? { reasoning_content: thinking } : {}),
    ...(message.toolCalls?.length
      ? { tool_calls: toOpenAIAssistantToolCalls(message.toolCalls) }
      : {}),
  };
}

function toOpenAIAssistantToolCalls(toolCalls: ToolCall[]) {
  return toolCalls.map((call) => ({
    id: call.id,
    type: "function" as const,
    function: {
      name: call.name,
      arguments: JSON.stringify(call.arguments),
    },
  }));
}

export function toOpenAITools(tools: LlmToolDefinition[] | undefined) {
  if (!tools?.length) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function parseOpenAIToolCalls(
  toolCalls:
    | Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>
    | undefined,
): ToolCall[] {
  if (!toolCalls?.length) {
    return [];
  }

  return toolCalls.flatMap((call) => {
    const name = call.function?.name?.trim();
    const id = call.id?.trim();

    if (!name || !id) {
      return [];
    }

    return [
      {
        id,
        name,
        arguments: parseJsonRecord(call.function?.arguments ?? "{}"),
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
}) {
  return {
    model: options.model,
    ...(options.stream ? { stream: true } : {}),
    ...(options.streamOptions ? { stream_options: { include_usage: options.streamOptions.includeUsage } } : {}),
    messages: await toOpenAIMessages(
      options.system,
      options.messages,
      options.provider ?? "openai",
    ),
    ...(options.tools?.length
      ? { tools: toOpenAITools(options.tools), tool_choice: "auto" }
      : {}),
  };
}

async function requestChatCompletion(
  client: OpenAIClientConfig,
  options: {
    model: string;
    system: string;
    messages: ChatMessage[];
    tools?: LlmToolDefinition[];
  },
): Promise<ChatCompletionResult> {
  const response = await fetch(chatCompletionsUrl(client), {
    method: "POST",
    headers: buildRequestHeaders(client),
    body: JSON.stringify(
      await buildChatCompletionRequestBody({ ...options, provider: client.providerName }),
    ),
  });

  if (!response.ok) {
    throw new Error(
      `${client.label} request failed (${response.status}): ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    usage?: Record<string, unknown>;
    choices?: Array<{
      message?: {
        content?: string | null;
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

  if (!content.trim() && toolCalls.length === 0) {
    throw new Error(`${client.label} returned an empty response.`);
  }

  return buildChatCompletionResult({
    content,
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
    tools?: LlmToolDefinition[];
    handlers: StreamChatHandlers;
  },
): Promise<ChatCompletionResult> {
  const response = await fetch(chatCompletionsUrl(client), {
    method: "POST",
    headers: buildRequestHeaders(client),
    body: JSON.stringify(
      await buildChatCompletionRequestBody({
        model: options.model,
        system: options.system,
        messages: options.messages,
        tools: options.tools,
        stream: true,
        streamOptions: { includeUsage: true },
        provider: client.providerName,
      }),
    ),
  });

  if (!response.ok) {
    throw new Error(
      `${client.label} request failed (${response.status}): ${await response.text()}`,
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
  },
): Promise<GenerateTextResult> {
  const response = await fetch(chatCompletionsUrl(client), {
    method: "POST",
    headers: buildRequestHeaders(client),
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      ...(options.responseFormat
        ? { response_format: options.responseFormat }
        : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `${client.label} request failed (${response.status}): ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  const content = payload.choices?.[0]?.message?.content?.trim();
  const usage = extractOpenAITokenUsage((payload as { usage?: Record<string, unknown> }).usage);

  if (!content) {
    throw new Error(`${client.label} returned an empty response.`);
  }

  return {
    content,
    ...(usage ? { usage } : {}),
  };
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

function mergePendingToolCall(
  pending: Map<number, PendingToolCall>,
  toolDelta: {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  },
): void {
  const index = toolDelta.index ?? 0;
  const current = pending.get(index) ?? {
    id: "",
    name: "",
    arguments: "",
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
  pending: Map<number, PendingToolCall>,
): ToolCall[] {
  return [...pending.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, call]) => call)
    .flatMap((call) => {
      if (!call.id || !call.name) {
        return [];
      }

      return [
        {
          id: call.id,
          name: call.name,
          arguments: parseJsonRecord(call.arguments),
        },
      ];
    });
}

async function readOpenAIStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamChatHandlers,
  label = "OpenAI",
): Promise<ChatCompletionResult> {
  let content = "";
  let usage: ChatCompletionResult["usage"];
  const pending = new Map<number, PendingToolCall>();

  await readSseEvents(body, ({ data }) => {
    const payload = JSON.parse(data) as {
      usage?: Record<string, unknown>;
      choices?: Array<{
        delta?: {
          content?: string | null;
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

  if (!content.trim() && toolCalls.length === 0) {
    throw new Error(`${label} returned an empty response.`);
  }

  return buildChatCompletionResult({ content, toolCalls, usage });
}
