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
  finalizePendingToolCalls,
  mergePendingToolCall,
  normalizeThinkingEffort,
  notifyToolInputDelta,
  type PendingToolCall,
  type ProviderJsonRecord,
  parseJsonRecord,
  readProviderString,
  readRecord,
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
  | { role: "user"; content: string | ProviderJsonRecord[] }
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
  const options: ConstructorParameters<typeof OpenRouter>[0] = {
    apiKey,
    appTitle: OPENROUTER_APP_TITLE,
    httpReferer: OPENROUTER_REFERER,
  };

  if (fetcher) {
    options.httpClient = new HTTPClient({ fetcher });
  }

  return new OpenRouter(options);
}

function formatOpenRouterError<ProviderError>(error: ProviderError): Error {
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
    value instanceof Object &&
    "url" in value &&
    readProviderString(value.url) !== undefined
  );
}

function toSdkUserContent(
  content: Extract<OpenAIMessage, { role: "user" }>["content"]
): string | ChatContentItems[] {
  if (!Array.isArray(content)) {
    return content;
  }

  return content.map((part): ChatContentItems => {
    if (part.type === "image_url" && isImageUrl(part.image_url)) {
      return {
        imageUrl: { url: part.image_url.url },
        type: "image_url",
      };
    }

    const fileData = readProviderString(part.file_data);

    if (part.type === "input_file" && fileData !== undefined) {
      const file: NonNullable<
        Extract<ChatContentItems, { file: object }>["file"]
      > = {
        fileData,
      };

      const filename = readProviderString(part.filename);

      if (filename !== undefined) {
        file.filename = filename;
      }

      return {
        file,
        type: "file",
      };
    }

    // SAFETY: The upstream payload is validated or constructed by the provider adapter before this conversion.
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
    const sdkMessage: ChatMessages = {
      content: message.content,
      role: "assistant",
    };

    if (message.tool_calls?.length) {
      sdkMessage.toolCalls = message.tool_calls.map((call) => ({
        function: {
          arguments: call.function.arguments,
          name: call.function.name,
        },
        id: call.id,
        type: "function",
      }));
    }

    return sdkMessage;
  }

  if (message.role === "tool") {
    return {
      content: message.content,
      role: "tool",
      toolCallId: message.tool_call_id,
    };
  }

  // SAFETY: The upstream payload is validated or constructed by the provider adapter before this conversion.
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
  usage?: ProviderJsonRecord;
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
  const content = message?.content ?? "";
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

  const request: Omit<ChatRequest, "stream"> = {
    messages: await toSdkMessages(options.system, options.messages),
    model: options.model,
    ...reasoningRequest,
  };

  if (tools?.length) {
    request.toolChoice = "auto";
    request.tools = tools;
  }

  return request;
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

    usage = extractOpenAITokenUsage(readRecord(chunk).usage) ?? usage;

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

        const request: ChatRequest = { ...chatRequest, stream: false };

        if (provider) {
          request.provider = provider;
        }

        const result = await client.chat.send(
          { chatRequest: request },
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
        const chatRequest: ChatRequest = {
          messages: [
            { content: system, role: "system" },
            { content: input.prompt, role: "user" },
          ],
          model,
          stream: false,
        };

        if (provider) {
          chatRequest.provider = provider;
        }

        if (useJson) {
          chatRequest.responseFormat = { type: "json_object" };
        }

        const result = await client.chat.send({ chatRequest });

        const content = result.choices?.[0]?.message?.content?.trim();

        const usage = extractOpenAITokenUsage(readRecord(result).usage);

        if (!content) {
          throw new Error(`${PROVIDER_LABEL} returned an empty response.`);
        }

        const textResult: GenerateTextResult = { content };

        if (usage) {
          textResult.usage = usage;
        }

        return textResult;
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

        const streamRequest: ChatRequest = { ...chatRequest, stream: true };

        if (provider) {
          streamRequest.provider = provider;
        }

        const request = { chatRequest: streamRequest };

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
