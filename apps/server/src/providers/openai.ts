import type {
  ChatCompletionResult,
  ChatMessage,
  GenerateChatInput,
  GenerateTextInput,
  LlmToolDefinition,
  ProviderClient,
  StreamChatHandlers,
  ToolCall,
} from "@tinyclaw/core";
import { messagesIncludeUserImages, toOpenAIChatUserContent } from "@tinyclaw/core";
import { generateOpenAIResponsesChat } from "./openai-responses";

export interface OpenAIProviderOptions {
  apiKey: string;
  model?: string;
}

export function createOpenAIProvider(
  options: OpenAIProviderOptions,
): ProviderClient {
  const model = options.model ?? "gpt-5.4";

  return {
    name: "openai",
    generateText(input: GenerateTextInput) {
      const useJson = (input.format ?? "json") === "json";
      const system = useJson
        ? input.system
        : `${input.system}\n\nReturn only the requested text. No JSON, keys, labels, markdown fences, or surrounding quotes.`;

      return requestCompletion({
        apiKey: options.apiKey,
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: input.prompt },
        ],
        responseFormat: useJson ? { type: "json_object" } : undefined,
      });
    },
    generateChat(input: GenerateChatInput) {
      if (usesResponsesApi(input)) {
        return generateOpenAIResponsesChat({
          apiKey: options.apiKey,
          model,
          input,
          stream: false,
        });
      }

      return requestChatCompletion({
        apiKey: options.apiKey,
        model,
        system: input.system,
        messages: input.messages,
        tools: input.tools,
      });
    },
    streamChat(input: GenerateChatInput, handlers: StreamChatHandlers) {
      if (usesResponsesApi(input)) {
        return generateOpenAIResponsesChat({
          apiKey: options.apiKey,
          model,
          input,
          stream: true,
          handlers,
        });
      }

      return streamChatCompletion({
        apiKey: options.apiKey,
        model,
        system: input.system,
        messages: input.messages,
        tools: input.tools,
        handlers,
      });
    },
  };
}

function usesResponsesApi(input: GenerateChatInput): boolean {
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

export function toOpenAIMessages(
  system: string,
  messages: ChatMessage[],
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [{ role: "system", content: system }];

  for (const message of messages) {
    if (message.role === "user") {
      result.push({
        role: "user",
        content: toOpenAIChatUserContent(message.content) as string | Array<Record<string, unknown>>,
      });
      continue;
    }

    if (message.role === "assistant") {
      const entry: Extract<OpenAIMessage, { role: "assistant" }> = {
        role: "assistant",
        content: message.content || null,
      };

      if (message.toolCalls?.length) {
        entry.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        }));
      }

      result.push(entry);
      continue;
    }

    result.push({
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    });
  }

  return result;
}

function toOpenAITools(tools: LlmToolDefinition[] | undefined) {
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

function parseToolArguments(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();

  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseOpenAIToolCalls(
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
        arguments: parseToolArguments(call.function?.arguments ?? "{}"),
      },
    ];
  });
}

function buildChatCompletionResult(options: {
  content: string | null | undefined;
  toolCalls: ToolCall[];
}): ChatCompletionResult {
  const content = options.content?.trim() ?? "";
  const assistantMessage: Extract<ChatMessage, { role: "assistant" }> = {
    role: "assistant",
    content,
    ...(options.toolCalls.length > 0 ? { toolCalls: options.toolCalls } : {}),
  };

  return {
    content,
    toolCalls: options.toolCalls,
    assistantMessage,
  };
}

async function requestChatCompletion(options: {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: LlmToolDefinition[];
}): Promise<ChatCompletionResult> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages: toOpenAIMessages(options.system, options.messages),
      ...(options.tools?.length
        ? { tools: toOpenAITools(options.tools), tool_choice: "auto" }
        : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI request failed (${response.status}): ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
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
    throw new Error("OpenAI returned an empty response.");
  }

  return buildChatCompletionResult({ content, toolCalls });
}

async function streamChatCompletion(options: {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: LlmToolDefinition[];
  handlers: StreamChatHandlers;
}): Promise<ChatCompletionResult> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      stream: true,
      messages: toOpenAIMessages(options.system, options.messages),
      ...(options.tools?.length
        ? { tools: toOpenAITools(options.tools), tool_choice: "auto" }
        : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI request failed (${response.status}): ${await response.text()}`,
    );
  }

  if (!response.body) {
    throw new Error("OpenAI returned an empty stream.");
  }

  return readOpenAIStream(response.body, options.handlers);
}

async function requestCompletion(options: {
  apiKey: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  responseFormat?: { type: "json_object" };
}): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
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
      `OpenAI request failed (${response.status}): ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  const content = payload.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("OpenAI returned an empty response.");
  }

  return content;
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

async function readOpenAIStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamChatHandlers,
): Promise<ChatCompletionResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const pending = new Map<number, PendingToolCall>();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const boundary = buffer.indexOf("\n\n");

      if (boundary < 0) {
        break;
      }

      const eventBlock = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      for (const line of eventBlock.split("\n")) {
        if (!line.startsWith("data: ")) {
          continue;
        }

        const data = line.slice(6).trim();

        if (!data || data === "[DONE]") {
          continue;
        }

        const payload = JSON.parse(data) as {
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

        const delta = payload.choices?.[0]?.delta;

        if (delta?.content) {
          content += delta.content;
          handlers.onChunk(delta.content);
        }

        if (delta?.tool_calls) {
          for (const toolDelta of delta.tool_calls) {
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
        }
      }
    }
  }

  const toolCalls = [...pending.entries()]
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
          arguments: parseToolArguments(call.arguments),
        },
      ];
    });

  if (!content.trim() && toolCalls.length === 0) {
    throw new Error("OpenAI returned an empty response.");
  }

  return buildChatCompletionResult({ content, toolCalls });
}
