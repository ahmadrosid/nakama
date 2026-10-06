import { setTimeout as delay } from "node:timers/promises";
import type {
  ChatCompletionResult,
  ChatMessage,
  CustomModelEntry,
  GenerateChatInput,
  GenerateTextInput,
  GenerateTextResult,
  LlmToolDefinition,
  OpenRouterRoutingSettings,
  ProviderChatOptions,
  ProviderClient,
  StreamChatHandlers,
  ToolCall,
} from "@nakama/core";
import type { Fetcher } from "@openrouter/sdk";
import { HTTPClient, OpenRouter } from "@openrouter/sdk";
import type {
  ChatContentItems,
  ChatFunctionTool,
  ChatMessages,
  ChatRequest,
  ChatRequestReasoning,
  ChatStreamChunk,
  ChatStreamToolCall,
  ChatToolCall,
} from "@openrouter/sdk/models";
import {
  OpenRouterError,
  SDKValidationError,
} from "@openrouter/sdk/models/errors";
import { toOpenAIMessages } from "../openai";
import {
  buildChatCompletionResult,
  extractOpenAITokenUsage,
  normalizeThinkingEffort,
  notifyToolInputDelta,
  parseJsonRecord,
} from "../shared";
import { openRouterModelSupportsThinking } from "./thinking";

const OPENROUTER_REFERER = "https://github.com/ahmadrosid/nakama";
const OPENROUTER_APP_TITLE = "Nakama";
const PROVIDER_LABEL = "OpenRouter";
const STREAM_RETRY_DELAY_MS = 100;

export interface OpenRouterProviderOptions {
  apiKey: string;
  customModels?: CustomModelEntry[];
  /** Injected in tests to mock HTTP without touching global fetch. */
  fetcher?: Fetcher;
  model?: string;
  openRouterRouting?: OpenRouterRoutingSettings;
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

function createOpenRouterClient(apiKey: string, fetcher?: Fetcher): OpenRouter {
  return new OpenRouter({
    apiKey,
    appTitle: OPENROUTER_APP_TITLE,
    httpReferer: OPENROUTER_REFERER,
    ...(fetcher ? { httpClient: new HTTPClient({ fetcher }) } : {}),
  });
}

function formatOpenRouterError(error: unknown): Error {
  if (error instanceof SDKValidationError) {
    return new Error(`${PROVIDER_LABEL} returned an invalid response.`);
  }

  if (error instanceof OpenRouterError) {
    return new Error(
      `${PROVIDER_LABEL} request failed (${error.statusCode}): ${error.body}`
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(`${PROVIDER_LABEL} request failed.`);
}

async function withOpenRouterError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw formatOpenRouterError(error);
  }
}

function toSdkTools(
  tools: LlmToolDefinition[] | undefined
): ChatFunctionTool[] | undefined {
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

function isImageUrl(value: unknown): value is { url: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { url?: unknown }).url === "string"
  );
}

function toSdkUserContent(
  content: Extract<OpenAIMessage, { role: "user" }>["content"]
): string | ChatContentItems[] {
  if (typeof content === "string") {
    return content;
  }

  return content.map((part): ChatContentItems => {
    if (part.type === "image_url" && isImageUrl(part.image_url)) {
      return {
        imageUrl: { url: part.image_url.url },
        type: "image_url",
      };
    }

    if (part.type === "input_file" && typeof part.file_data === "string") {
      return {
        file: {
          fileData: part.file_data,
          ...(typeof part.filename === "string"
            ? { filename: part.filename }
            : {}),
        },
        type: "file",
      };
    }

    return part as ChatContentItems;
  });
}

function openAIMessageToSdkMessage(message: OpenAIMessage): ChatMessages {
  if (message.role === "user") {
    return {
      content: toSdkUserContent(message.content),
      role: "user",
    };
  }

  if (message.role === "assistant") {
    return {
      content: message.content,
      role: "assistant",
      ...(message.tool_calls?.length
        ? {
            toolCalls: message.tool_calls.map((call) => ({
              function: {
                arguments: call.function.arguments,
                name: call.function.name,
              },
              id: call.id,
              type: "function" as const,
            })),
          }
        : {}),
    };
  }

  if (message.role === "tool") {
    return {
      content: message.content,
      role: "tool",
      toolCallId: message.tool_call_id,
    };
  }

  return message as ChatMessages;
}

async function toSdkMessages(
  system: string,
  messages: ChatMessage[]
): Promise<ChatMessages[]> {
  const openAIMessages = await toOpenAIMessages(system, messages, "openrouter");
  return openAIMessages.map(openAIMessageToSdkMessage);
}

function parseSdkToolCalls(toolCalls: ChatToolCall[] | undefined): ToolCall[] {
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
        arguments: parseJsonRecord(call.function.arguments ?? "{}"),
        id,
        name,
      },
    ];
  });
}

function buildOpenRouterReasoningRequest(
  model: string,
  providerOptions: ProviderChatOptions | undefined,
  customModels: CustomModelEntry[] | undefined
): Pick<ChatRequest, "reasoning"> | undefined {
  if (
    !(
      providerOptions?.thinking?.enabled &&
      openRouterModelSupportsThinking(model, customModels)
    )
  ) {
    return;
  }

  const reasoning: ChatRequestReasoning = {
    effort: normalizeThinkingEffort(providerOptions.thinking.effort),
    summary: "auto",
  };

  return { reasoning };
}

function parseMessageReasoning(
  reasoning: string | null | undefined
): string | undefined {
  const trimmed = reasoning?.trim();
  return trimmed || undefined;
}

function parseChatResult(result: {
  usage?: Record<string, unknown>;
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning?: string | null;
      toolCalls?: ChatToolCall[];
    };
  }>;
}): ChatCompletionResult {
  const message = result.choices?.[0]?.message;
  const toolCalls = parseSdkToolCalls(message?.toolCalls);
  const content = typeof message?.content === "string" ? message.content : "";
  const thinking = parseMessageReasoning(message?.reasoning);

  if (!content.trim() && toolCalls.length === 0 && !thinking) {
    throw new Error(`${PROVIDER_LABEL} returned an empty response.`);
  }

  return buildChatCompletionResult({
    content,
    thinking,
    toolCalls,
    usage: extractOpenAITokenUsage(result.usage),
  });
}

async function buildChatRequestBase(options: {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: LlmToolDefinition[];
  providerOptions?: ProviderChatOptions;
  customModels?: CustomModelEntry[];
}): Promise<Omit<ChatRequest, "stream">> {
  const tools = toSdkTools(options.tools);
  const reasoningRequest = buildOpenRouterReasoningRequest(
    options.model,
    options.providerOptions,
    options.customModels
  );

  return {
    messages: await toSdkMessages(options.system, options.messages),
    model: options.model,
    ...(tools?.length ? { toolChoice: "auto" as const, tools } : {}),
    ...reasoningRequest,
  };
}

interface PendingToolCall {
  arguments: string;
  id: string;
  name: string;
}

class OpenRouterStreamError extends Error {
  readonly code: number;

  constructor(
    error: NonNullable<ChatStreamChunk["error"]>,
    readonly outputStarted: boolean
  ) {
    const message = error.message
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .slice(0, 300);
    super(
      `${PROVIDER_LABEL} stream failed (${error.code}): ${message || "Unknown error."}`
    );
    this.code = error.code;
  }
}

function mergePendingToolCall(
  pending: Map<number, PendingToolCall>,
  toolDelta: ChatStreamToolCall
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

async function readOpenRouterStream(
  stream: AsyncIterable<ChatStreamChunk>,
  handlers: StreamChatHandlers,
  signal?: AbortSignal
): Promise<ChatCompletionResult> {
  let content = "";
  let thinking = "";
  let usage: ChatCompletionResult["usage"];
  const pending = new Map<number, PendingToolCall>();

  for await (const chunk of stream) {
    // Fetch cancellation does not discard chunks already buffered by the SDK.
    signal?.throwIfAborted();
    const delta = chunk.choices?.[0]?.delta;
    const outputStarted = Boolean(
      content ||
        thinking ||
        pending.size ||
        delta?.content ||
        delta?.reasoning ||
        delta?.toolCalls?.length
    );

    if (chunk.error) {
      throw new OpenRouterStreamError(chunk.error, outputStarted);
    }

    usage =
      extractOpenAITokenUsage(
        (chunk as { usage?: Record<string, unknown> }).usage
      ) ?? usage;

    if (delta?.reasoning) {
      thinking += delta.reasoning;
      handlers.onThinking?.(delta.reasoning);
      signal?.throwIfAborted();
    }

    if (delta?.content) {
      content += delta.content;
      handlers.onChunk(delta.content);
      signal?.throwIfAborted();
    }

    if (delta?.toolCalls) {
      for (const toolDelta of delta.toolCalls) {
        const argDelta = toolDelta.function?.arguments ?? "";
        mergePendingToolCall(pending, toolDelta);

        if (argDelta) {
          const current = pending.get(toolDelta.index ?? 0);

          if (current) {
            notifyToolInputDelta(handlers, current, argDelta);
            signal?.throwIfAborted();
          }
        }
      }
    }
  }

  signal?.throwIfAborted();
  const toolCalls = finalizePendingToolCalls(pending);
  const thinkingText = thinking.trim() || undefined;

  if (!content.trim() && toolCalls.length === 0 && !thinkingText) {
    throw new Error(`${PROVIDER_LABEL} returned an empty response.`);
  }

  return buildChatCompletionResult({
    content,
    thinking: thinkingText,
    toolCalls,
    usage,
  });
}

export function createOpenRouterProvider(
  options: OpenRouterProviderOptions
): ProviderClient {
  const model = options.model ?? "anthropic/claude-sonnet-4-6";
  const customModels = options.customModels;
  const client = createOpenRouterClient(options.apiKey, options.fetcher);
  // The SDK serializes camelCase policy names to the OpenRouter wire format.
  const routing = options.openRouterRouting;
  const provider =
    routing && Object.values(routing).some((value) => value !== undefined)
      ? {
          dataCollection: routing.dataCollection,
          requireParameters: routing.requireParameters,
          zdr: routing.zdr,
        }
      : undefined;

  return {
    generateChat(input: GenerateChatInput) {
      return withOpenRouterError(async () => {
        const chatRequest = await buildChatRequestBase({
          customModels,
          messages: input.messages,
          model,
          providerOptions: input.providerOptions,
          system: input.system,
          tools: input.tools,
        });
        const result = await client.chat.send(
          {
            chatRequest: {
              ...chatRequest,
              ...(provider ? { provider } : {}),
              stream: false as const,
            },
          },
          { fetchOptions: { signal: input.signal } }
        );

        return parseChatResult(result);
      });
    },
    generateText(input: GenerateTextInput) {
      const useJson = (input.format ?? "json") === "json";
      const system = useJson
        ? input.system
        : `${input.system}\n\nReturn only the requested text. No JSON, keys, labels, markdown fences, or surrounding quotes.`;

      return withOpenRouterError(async () => {
        const result = await client.chat.send({
          chatRequest: {
            ...(provider ? { provider } : {}),
            messages: [
              { content: system, role: "system" },
              { content: input.prompt, role: "user" },
            ],
            model,
            stream: false,
            ...(useJson
              ? { responseFormat: { type: "json_object" as const } }
              : {}),
          },
        });

        const content = result.choices?.[0]?.message?.content?.trim();
        const usage = extractOpenAITokenUsage(
          (result as { usage?: Record<string, unknown> }).usage
        );

        if (!content) {
          throw new Error(`${PROVIDER_LABEL} returned an empty response.`);
        }

        return {
          content,
          ...(usage ? { usage } : {}),
        } satisfies GenerateTextResult;
      });
    },
    name: "openrouter",
    streamChat(input: GenerateChatInput, handlers: StreamChatHandlers) {
      return withOpenRouterError(async () => {
        input.signal?.throwIfAborted();
        const chatRequest = await buildChatRequestBase({
          customModels,
          messages: input.messages,
          model,
          providerOptions: input.providerOptions,
          system: input.system,
          tools: input.tools,
        });
        const request = {
          chatRequest: {
            ...chatRequest,
            ...(provider ? { provider } : {}),
            stream: true as const,
          },
        };

        for (let attempt = 0; ; attempt += 1) {
          try {
            const stream = await client.chat.send(request, {
              fetchOptions: { signal: input.signal },
              retries: { strategy: "none" },
            });
            return await readOpenRouterStream(stream, handlers, input.signal);
          } catch (error) {
            if (
              !(
                error instanceof OpenRouterStreamError &&
                error.code === 429 &&
                !error.outputStarted &&
                attempt === 0
              )
            ) {
              throw error;
            }

            await delay(STREAM_RETRY_DELAY_MS, undefined, {
              signal: input.signal,
            });
          }
        }
      });
    },
  };
}
