import type {
  ChatCompletionResult,
  ChatMessage,
  GenerateChatInput,
  GenerateTextInput,
  GenerateTextResult,
  LlmToolDefinition,
  ProviderChatOptions,
  ProviderClient,
  StreamChatHandlers,
  ToolCall,
  WireApi,
} from "@nakama/core";
import { fetchWithoutIdleTimeout, normalizeBaseUrl } from "@nakama/core";
import OpenAI from "openai";
import {
  parseOpenAIToolCalls,
  toOpenAIMessages,
  toOpenAITools,
} from "../openai";
import { generateOpenAIResponsesChat } from "../openai/responses";
import { openAIModelRejectsChatToolsWithReasoning } from "../openai/thinking";
import {
  buildChatCompletionResult,
  extractOpenAITokenUsage,
  formatHttpErrorBody,
  normalizeThinkingEffort,
  notifyToolInputDelta,
  parseJsonRecord,
  readSseEvents,
} from "../shared";

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  baseUrl: string;
  displayName: string;
  model: string;
  providerName?: ProviderClient["name"];
  supportsThinking: boolean;
  /** `responses` targets `/responses`; anything else stays on `/chat/completions`. */
  wireApi?: WireApi;
}

interface PendingToolCall {
  arguments: string;
  id: string;
  name: string;
}

export function createOpenAICompatibleProvider(
  options: OpenAICompatibleProviderOptions
): ProviderClient {
  const label = options.displayName.trim() || "Custom provider";
  const model = options.model;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const apiKey = options.apiKey || "not-needed";
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
    fetch: fetchWithoutIdleTimeout,
    maxRetries: 0,
    timeout: 600_000,
  });
  const useResponsesApi = options.wireApi === "responses";

  return {
    generateChat(input: GenerateChatInput) {
      if (useResponsesApi) {
        return generateOpenAIResponsesChat({
          apiKey,
          baseUrl,
          input,
          label,
          model,
          stream: false,
          supportsThinking: options.supportsThinking,
        });
      }

      return requestChatCompletion(client, label, {
        messages: input.messages,
        model,
        signal: input.signal,
        system: input.system,
        thinking: options.supportsThinking
          ? input.providerOptions?.thinking
          : undefined,
        tools: input.tools,
      });
    },
    generateText(input: GenerateTextInput) {
      const useJson = (input.format ?? "json") === "json";
      const system = useJson
        ? input.system
        : `${input.system}\n\nReturn only the requested text. No JSON, keys, labels, markdown fences, or surrounding quotes.`;

      if (useResponsesApi) {
        return generateResponsesText({
          apiKey,
          baseUrl,
          json: useJson,
          label,
          model,
          prompt: input.prompt,
          system,
        });
      }

      return requestCompletion(client, label, {
        messages: [
          { content: system, role: "system" },
          { content: input.prompt, role: "user" },
        ],
        model,
        responseFormat: useJson ? { type: "json_object" } : undefined,
      });
    },
    name: options.providerName ?? "openai_compatible",
    streamChat(input: GenerateChatInput, handlers: StreamChatHandlers) {
      if (useResponsesApi) {
        return generateOpenAIResponsesChat({
          apiKey,
          baseUrl,
          handlers,
          input,
          label,
          model,
          stream: true,
          supportsThinking: options.supportsThinking,
        });
      }

      return streamChatCompletion({
        apiKey,
        baseUrl,
        handlers,
        label,
        messages: input.messages,
        model,
        signal: input.signal,
        system: input.system,
        thinking: options.supportsThinking
          ? input.providerOptions?.thinking
          : undefined,
        tools: input.tools,
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
  messages: ChatMessage[]
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  return (await toOpenAIMessages(
    system,
    messages,
    "openai_compatible"
  )) as OpenAI.Chat.ChatCompletionMessageParam[];
}

function readReasoningText(
  value: unknown,
  options?: { preserveWhitespace?: boolean }
): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  const record = value as Record<string, unknown>;
  const direct =
    typeof record.reasoning === "string"
      ? record.reasoning
      : typeof record.reasoning_content === "string"
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

function buildThinkingBody(
  thinking: ProviderChatOptions["thinking"] | undefined,
  options: { model: string; hasTools: boolean }
) {
  // OpenAI gpt-5.4+ chat/completions rejects tools + non-none reasoning_effort
  // (including when the API would default effort). Force none whenever tools are present.
  if (
    options.hasTools &&
    openAIModelRejectsChatToolsWithReasoning(options.model)
  ) {
    return { reasoning_effort: "none" };
  }

  if (!thinking?.enabled) {
    return {};
  }

  const effort = normalizeThinkingEffort(thinking.effort);

  return {
    reasoning: { effort },
    // Rapid MLX and other local OpenAI-compatible servers use top-level reasoning_effort.
    reasoning_effort: effort,
  };
}

async function requestChatCompletion(
  client: OpenAI,
  label: string,
  options: {
    model: string;
    system: string;
    messages: ChatMessage[];
    signal?: AbortSignal;
    tools?: LlmToolDefinition[];
    thinking?: ProviderChatOptions["thinking"];
  }
): Promise<ChatCompletionResult> {
  try {
    const completion = await client.chat.completions.create(
      {
        messages: await buildMessages(options.system, options.messages),
        model: options.model,
        ...buildThinkingBody(options.thinking, {
          hasTools: Boolean(options.tools?.length),
          model: options.model,
        }),
        ...(options.tools?.length
          ? {
              tool_choice: "auto" as const,
              tools: toOpenAITools(options.tools),
            }
          : {}),
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      { signal: options.signal }
    );

    const message = completion.choices[0]?.message;
    const toolCalls = parseOpenAIToolCalls(
      message?.tool_calls as
        | Array<{
            id?: string;
            function?: { name?: string; arguments?: string };
          }>
        | undefined
    );
    const content = message?.content ?? "";
    const thinking = readReasoningText(message);

    if (!content.trim() && toolCalls.length === 0 && !thinking?.trim()) {
      throw new Error(`${label} returned an empty response.`);
    }

    return buildChatCompletionResult({
      content,
      thinking,
      toolCalls,
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
  signal?: AbortSignal;
}): Promise<ChatCompletionResult> {
  const response = await fetchWithoutIdleTimeout(
    `${options.baseUrl}/chat/completions`,
    {
      body: JSON.stringify({
        messages: await buildMessages(options.system, options.messages),
        model: options.model,
        stream: true,
        stream_options: { include_usage: true },
        ...buildThinkingBody(options.thinking, {
          hasTools: Boolean(options.tools?.length),
          model: options.model,
        }),
        ...(options.tools?.length
          ? {
              tool_choice: "auto",
              tools: toOpenAITools(options.tools),
            }
          : {}),
      }),
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: options.signal,
    }
  );

  const bodyText = response.ok ? null : await response.text();

  if (!response.ok) {
    throw new Error(
      formatHttpErrorBody(options.label, response.status, bodyText ?? "")
    );
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    throw new Error(
      formatHttpErrorBody(options.label, response.status, await response.text())
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

    const reasoningDelta = readReasoningText(delta, {
      preserveWhitespace: true,
    });

    if (reasoningDelta) {
      thinking += reasoningDelta;
      options.handlers.onThinking?.(reasoningDelta);
    }

    if (delta?.tool_calls) {
      for (const toolDelta of delta.tool_calls) {
        const argDelta = toolDelta.function?.arguments ?? "";
        mergePendingToolCall(pending, toolDelta);

        if (argDelta) {
          const current = pending.get(toolDelta.index ?? 0);

          if (current) {
            notifyToolInputDelta(options.handlers, current, argDelta);
          }
        }
      }
    }
  });

  const toolCalls = finalizePendingToolCalls(pending);

  if (!content.trim() && toolCalls.length === 0 && !thinking.trim()) {
    throw new Error(`${options.label} returned an empty response.`);
  }

  return buildChatCompletionResult({ content, thinking, toolCalls, usage });
}

async function generateResponsesText(options: {
  apiKey: string;
  baseUrl: string;
  json: boolean;
  label: string;
  model: string;
  prompt: string;
  system: string;
}): Promise<GenerateTextResult> {
  const result = await generateOpenAIResponsesChat({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    input: {
      messages: [{ content: options.prompt, role: "user" }],
      system: options.system,
    },
    jsonOutput: options.json,
    label: options.label,
    model: options.model,
    stream: false,
  });
  const content = result.content.trim();

  if (!content) {
    throw new Error(`${options.label} returned an empty response.`);
  }

  return {
    content,
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

async function requestCompletion(
  client: OpenAI,
  label: string,
  options: {
    model: string;
    messages: Array<{ role: "system" | "user"; content: string }>;
    responseFormat?: { type: "json_object" };
  }
): Promise<GenerateTextResult> {
  try {
    const completion = await client.chat.completions.create({
      messages: options.messages,
      model: options.model,
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
