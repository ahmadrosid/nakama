import {
  type ChatCompletionResult,
  type ChatMessage,
  type CustomModelEntry,
  fetchWithoutIdleTimeout,
  type GenerateChatInput,
  type GenerateTextInput,
  type GenerateTextResult,
  type LlmToolDefinition,
  type ProviderClient,
  type StreamChatHandlers,
  type ToolCall,
} from "@nakama/core";
import OpenAI from "openai";
import {
  parseOpenAIToolCalls,
  toOpenAIMessages,
  toOpenAITools,
} from "../openai";
import {
  buildChatCompletionResult,
  extractOpenAITokenUsage,
  formatHttpErrorBody,
  notifyToolInputDelta,
  parseJsonRecord,
  readSseEvents,
} from "../shared";

export const CLOUDFLARE_API_ROOT =
  "https://api.cloudflare.com/client/v4/accounts";
const PROVIDER_LABEL = "Cloudflare";

export interface CloudflareProviderOptions {
  accountId: string;
  apiKey: string;
  customModels?: CustomModelEntry[];
  model: string;
}

interface PendingToolCall {
  arguments: string;
  id: string;
  name: string;
}

export function createCloudflareProvider(
  options: CloudflareProviderOptions
): ProviderClient {
  const model = options.model;
  const apiKey = options.apiKey;
  const customModels = options.customModels;
  const baseURL = `${CLOUDFLARE_API_ROOT}/${options.accountId}/ai/v1`;
  const client = new OpenAI({
    apiKey,
    baseURL,
    fetch: fetchWithoutIdleTimeout,
    maxRetries: 0,
    timeout: 600_000,
  });

  return {
    generateChat(input: GenerateChatInput) {
      return requestChatCompletion(client, {
        messages: input.messages,
        model,
        signal: input.signal,
        system: input.system,
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
    name: "cloudflare",
    streamChat(input: GenerateChatInput, handlers: StreamChatHandlers) {
      return streamChatCompletion({
        accountId: options.accountId,
        apiKey,
        handlers,
        messages: input.messages,
        model,
        signal: input.signal,
        system: input.system,
        tools: input.tools,
      });
    },
  };
}

function formatSdkError(error: unknown): Error {
  if (error instanceof OpenAI.APIError) {
    const body =
      typeof error.error === "string"
        ? error.error
        : error.error
          ? JSON.stringify(error.error)
          : error.message;
    return new Error(
      formatHttpErrorBody(PROVIDER_LABEL, error.status ?? 0, body)
    );
  }

  if (error instanceof Error) {
    return new Error(`${PROVIDER_LABEL} request failed: ${error.message}`);
  }

  return new Error(`${PROVIDER_LABEL} request failed.`);
}

async function buildMessages(
  system: string,
  messages: ChatMessage[]
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  return (await toOpenAIMessages(
    system,
    messages,
    "cloudflare"
  )) as OpenAI.Chat.ChatCompletionMessageParam[];
}

async function requestChatCompletion(
  client: OpenAI,
  options: {
    model: string;
    system: string;
    messages: ChatMessage[];
    signal?: AbortSignal;
    tools?: LlmToolDefinition[];
  }
): Promise<ChatCompletionResult> {
  try {
    const completion = await client.chat.completions.create(
      {
        messages: await buildMessages(options.system, options.messages),
        model: options.model,
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

    if (!content.trim() && toolCalls.length === 0) {
      throw new Error(`${PROVIDER_LABEL} returned an empty response.`);
    }

    return buildChatCompletionResult({
      content,
      toolCalls,
      usage: extractOpenAITokenUsage(completion.usage),
    });
  } catch (error) {
    throw formatSdkError(error);
  }
}

async function streamChatCompletion(options: {
  accountId: string;
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: LlmToolDefinition[];
  handlers: StreamChatHandlers;
  signal?: AbortSignal;
}): Promise<ChatCompletionResult> {
  const response = await fetchWithoutIdleTimeout(
    `${CLOUDFLARE_API_ROOT}/${options.accountId}/ai/v1/chat/completions`,
    {
      body: JSON.stringify({
        messages: await buildMessages(options.system, options.messages),
        model: options.model,
        stream: true,
        stream_options: { include_usage: true },
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
      formatHttpErrorBody(PROVIDER_LABEL, response.status, bodyText ?? "")
    );
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    throw new Error(
      formatHttpErrorBody(
        PROVIDER_LABEL,
        response.status,
        await response.text()
      )
    );
  }

  if (!response.body) {
    throw new Error(`${PROVIDER_LABEL} returned an empty stream.`);
  }

  let content = "";
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

  if (!content.trim() && toolCalls.length === 0) {
    throw new Error(`${PROVIDER_LABEL} returned an empty response.`);
  }

  return buildChatCompletionResult({ content, toolCalls, usage });
}

async function requestCompletion(
  client: OpenAI,
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
      throw new Error(`${PROVIDER_LABEL} returned an empty response.`);
    }

    const usage = extractOpenAITokenUsage(completion.usage);
    return {
      content,
      ...(usage ? { usage } : {}),
    };
  } catch (error) {
    throw formatSdkError(error);
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
