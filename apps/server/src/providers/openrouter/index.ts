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
  StreamChatHandlers,
  ToolCall,
} from "@nakama/core";
import type { Fetcher } from "@openrouter/sdk";
import { HTTPClient, OpenRouter } from "@openrouter/sdk";
import type {
  ChatFunctionTool,
  ChatMessages,
  ChatRequest,
  ChatRequestReasoning,
  ChatStreamChunk,
  ChatStreamToolCall,
  ChatToolCall,
} from "@openrouter/sdk/models";
import { OpenRouterError } from "@openrouter/sdk/models/errors";
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

export interface OpenRouterProviderOptions {
  apiKey: string;
  customModels?: CustomModelEntry[];
  /** Injected in tests to mock HTTP without touching global fetch. */
  fetcher?: Fetcher;
  model?: string;
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

function openAIMessageToSdkMessage(message: OpenAIMessage): ChatMessages {
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
  handlers: StreamChatHandlers
): Promise<ChatCompletionResult> {
  let content = "";
  let thinking = "";
  let usage: ChatCompletionResult["usage"];
  const pending = new Map<number, PendingToolCall>();

  for await (const chunk of stream) {
    usage =
      extractOpenAITokenUsage(
        (chunk as { usage?: Record<string, unknown> }).usage
      ) ?? usage;
    const delta = chunk.choices?.[0]?.delta;

    if (delta?.reasoning) {
      thinking += delta.reasoning;
      handlers.onThinking?.(delta.reasoning);
    }

    if (delta?.content) {
      content += delta.content;
      handlers.onChunk(delta.content);
    }

    if (delta?.toolCalls) {
      for (const toolDelta of delta.toolCalls) {
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
  }

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

export { openRouterModelSupportsThinking } from "./thinking";

export function createOpenRouterProvider(
  options: OpenRouterProviderOptions
): ProviderClient {
  const model = options.model ?? "anthropic/claude-sonnet-4-6";
  const customModels = options.customModels;
  const client = createOpenRouterClient(options.apiKey, options.fetcher);

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
        const result = await client.chat.send({
          chatRequest: { ...chatRequest, stream: false as const },
        });

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
        const chatRequest = await buildChatRequestBase({
          customModels,
          messages: input.messages,
          model,
          providerOptions: input.providerOptions,
          system: input.system,
          tools: input.tools,
        });
        const stream = await client.chat.send({
          chatRequest: { ...chatRequest, stream: true as const },
        });

        return readOpenRouterStream(stream, handlers);
      });
    },
  };
}
