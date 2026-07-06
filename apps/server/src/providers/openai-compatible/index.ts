import type {
  ChatCompletionResult,
  ChatMessage,
  GenerateChatInput,
  GenerateTextResult,
  GenerateTextInput,
  LlmToolDefinition,
  ProviderChatOptions,
  ProviderClient,
  StreamChatHandlers,
  ToolCall,
} from "@nakama/core";
import { normalizeBaseUrl } from "@nakama/core";
import OpenAI from "openai";
import {
  buildChatCompletionResult,
  extractOpenAITokenUsage,
  formatHttpErrorBody,
  normalizeThinkingEffort,
  parseJsonRecord,
  readSseEvents,
} from "../shared";
import {
  parseOpenAIToolCalls,
  toOpenAIMessages,
  toOpenAITools,
} from "../openai";

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  displayName: string;
  supportsThinking: boolean;
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export function createOpenAICompatibleProvider(
  options: OpenAICompatibleProviderOptions,
): ProviderClient {
  const label = options.displayName.trim() || "Custom provider";
  const model = options.model;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const apiKey = options.apiKey || "not-needed";
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
    maxRetries: 0,
    timeout: 120_000,
  });

  return {
    name: "openai_compatible",
    generateText(input: GenerateTextInput) {
      const useJson = (input.format ?? "json") === "json";
      const system = useJson
        ? input.system
        : `${input.system}\n\nReturn only the requested text. No JSON, keys, labels, markdown fences, or surrounding quotes.`;

      return requestCompletion(client, label, {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: input.prompt },
        ],
        responseFormat: useJson ? { type: "json_object" } : undefined,
      });
    },
    generateChat(input: GenerateChatInput) {
      return requestChatCompletion(client, label, {
        model,
        system: input.system,
        messages: input.messages,
        tools: input.tools,
        thinking: options.supportsThinking ? input.providerOptions?.thinking : undefined,
      });
    },
    streamChat(input: GenerateChatInput, handlers: StreamChatHandlers) {
      return streamChatCompletion({
        label,
        baseUrl,
        apiKey,
        model,
        system: input.system,
        messages: input.messages,
        tools: input.tools,
        thinking: options.supportsThinking ? input.providerOptions?.thinking : undefined,
        handlers,
      });
    },
  };
}

function formatSdkError(label: string, error: unknown): Error {
  if (error instanceof OpenAI.APIError) {
    const body =
      typeof error.error === "string"
        ? error.error
        : error.error
          ? JSON.stringify(error.error)
          : error.message;
    return new Error(formatHttpErrorBody(label, error.status ?? 0, body));
  }

  if (error instanceof Error) {
    return new Error(`${label} request failed: ${error.message}`);
  }

  return new Error(`${label} request failed.`);
}

async function buildMessages(
  system: string,
  messages: ChatMessage[],
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  return (await toOpenAIMessages(system, messages, "openai_compatible")) as OpenAI.Chat.ChatCompletionMessageParam[];
}

function readReasoningText(
  value: unknown,
  options?: { preserveWhitespace?: boolean },
): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const direct =
    typeof record.reasoning === "string"
      ? record.reasoning
      : typeof record.reasoning_content === "string"
        ? record.reasoning_content
        : undefined;

  if (direct === undefined) {
    return undefined;
  }

  if (options?.preserveWhitespace) {
    return direct.length > 0 ? direct : undefined;
  }

  const trimmed = direct.trim();
  return trimmed ? trimmed : undefined;
}

async function requestChatCompletion(
  client: OpenAI,
  label: string,
  options: {
    model: string;
    system: string;
    messages: ChatMessage[];
    tools?: LlmToolDefinition[];
    thinking?: ProviderChatOptions["thinking"];
  },
): Promise<ChatCompletionResult> {
  try {
    const completion = await client.chat.completions.create({
      model: options.model,
      messages: await buildMessages(options.system, options.messages),
      ...(options.thinking?.enabled
        ? { reasoning: { effort: normalizeThinkingEffort(options.thinking.effort) } }
        : {}),
      ...(options.tools?.length
        ? {
            tools: toOpenAITools(options.tools),
            tool_choice: "auto" as const,
          }
        : {}),
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);

    const message = completion.choices[0]?.message;
    const toolCalls = parseOpenAIToolCalls(
      message?.tool_calls as
        | Array<{
            id?: string;
            function?: { name?: string; arguments?: string };
          }>
        | undefined,
    );
    const content = message?.content ?? "";
    const thinking = readReasoningText(message);

    if (!content.trim() && toolCalls.length === 0 && !thinking?.trim()) {
      throw new Error(`${label} returned an empty response.`);
    }

    return buildChatCompletionResult({
      content,
      toolCalls,
      thinking,
      usage: extractOpenAITokenUsage(completion.usage),
    });
  } catch (error) {
    throw formatSdkError(label, error);
  }
}

async function streamChatCompletion(options: {
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: LlmToolDefinition[];
  thinking?: ProviderChatOptions["thinking"];
  handlers: StreamChatHandlers;
}): Promise<ChatCompletionResult> {
  const response = await fetch(`${options.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      stream: true,
      messages: await buildMessages(options.system, options.messages),
      stream_options: { include_usage: true },
      ...(options.thinking?.enabled
        ? { reasoning: { effort: normalizeThinkingEffort(options.thinking.effort) } }
        : {}),
      ...(options.tools?.length
        ? {
            tools: toOpenAITools(options.tools),
            tool_choice: "auto",
          }
        : {}),
    }),
  });

  const bodyText = response.ok ? null : await response.text();

  if (!response.ok) {
    throw new Error(
      formatHttpErrorBody(options.label, response.status, bodyText ?? ""),
    );
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    throw new Error(
      formatHttpErrorBody(
        options.label,
        response.status,
        await response.text(),
      ),
    );
  }

  if (!response.body) {
    throw new Error(`${options.label} returned an empty stream.`);
  }

  let content = "";
  let thinking = "";
  let usage: ChatCompletionResult["usage"];
  const pending = new Map<number, PendingToolCall>();

  await readSseEvents(response.body, ({ data }) => {
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
      options.handlers.onChunk(delta.content);
    }

    const reasoningDelta = readReasoningText(delta, { preserveWhitespace: true });

    if (reasoningDelta) {
      thinking += reasoningDelta;
      options.handlers.onThinking?.(reasoningDelta);
    }

    if (delta?.tool_calls) {
      for (const toolDelta of delta.tool_calls) {
        mergePendingToolCall(pending, toolDelta);
      }
    }
  });

  const toolCalls = finalizePendingToolCalls(pending);

  if (!content.trim() && toolCalls.length === 0 && !thinking.trim()) {
    throw new Error(`${options.label} returned an empty response.`);
  }

  return buildChatCompletionResult({ content, toolCalls, thinking, usage });
}

async function requestCompletion(
  client: OpenAI,
  label: string,
  options: {
    model: string;
    messages: Array<{ role: "system" | "user"; content: string }>;
    responseFormat?: { type: "json_object" };
  },
): Promise<GenerateTextResult> {
  try {
    const completion = await client.chat.completions.create({
      model: options.model,
      messages: options.messages,
      ...(options.responseFormat
        ? { response_format: options.responseFormat }
        : {}),
    });

    const content = completion.choices[0]?.message?.content?.trim();

    if (!content) {
      throw new Error(`${label} returned an empty response.`);
    }

    const usage = extractOpenAITokenUsage(completion.usage);
    return {
      content,
      ...(usage ? { usage } : {}),
    };
  } catch (error) {
    throw formatSdkError(label, error);
  }
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
