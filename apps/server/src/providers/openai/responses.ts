import type {
  ChatCompletionResult,
  ChatMessage,
  CustomModelEntry,
  GenerateChatInput,
  LlmToolDefinition,
  StreamChatHandlers,
  ToolCall,
} from "@nakama/core";
import {
  isMessageContentPartArray,
  toOpenAIResponsesUserContent,
  WEB_SEARCH_TOOL_NAME,
} from "@nakama/core";
import {
  buildTokenUsage,
  normalizeThinkingEffort,
  parseJsonRecord,
  readRecord,
  readSseEvents,
} from "../shared";
import { openAIModelSupportsThinking } from "./thinking";

type ResponseItem = Record<string, unknown>;

export async function generateOpenAIResponsesChat(options: {
  apiKey: string;
  model: string;
  input: GenerateChatInput;
  stream: boolean;
  handlers?: StreamChatHandlers;
  customModels?: CustomModelEntry[];
}): Promise<ChatCompletionResult> {
  const body = await buildResponsesRequestBody(
    options.model,
    options.input,
    options.stream,
    options.customModels,
  );
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI request failed (${response.status}): ${await response.text()}`,
    );
  }

  if (options.stream) {
    if (!response.body) {
      throw new Error("OpenAI returned an empty stream.");
    }

    return readOpenAIResponsesStream(response.body, options.handlers);
  }

  const payload = (await response.json()) as {
    output?: ResponseItem[];
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  };
  return parseResponsesOutput(payload.output ?? [], options.handlers, payload.usage);
}

async function buildResponsesRequestBody(
  model: string,
  input: GenerateChatInput,
  stream: boolean,
  customModels?: CustomModelEntry[],
) {
  const tools = buildResponsesTools(input.tools, input.providerOptions?.webSearch ?? false);

  return {
    model,
    instructions: input.system,
    input: await toResponsesInput(input.messages),
    ...(tools.length > 0 ? { tools } : {}),
    ...buildOpenAIReasoningRequest(model, input, customModels),
    ...(stream ? { stream: true } : {}),
  };
}

function buildOpenAIReasoningRequest(
  model: string,
  input: GenerateChatInput,
  customModels?: CustomModelEntry[],
): Record<string, unknown> {
  if (
    !input.providerOptions?.thinking?.enabled ||
    !openAIModelSupportsThinking(model, customModels)
  ) {
    return {};
  }

  return {
    reasoning: {
      effort: normalizeThinkingEffort(input.providerOptions.thinking.effort),
      summary: "auto",
    },
  };
}

function buildResponsesTools(tools: LlmToolDefinition[] | undefined, webSearch: boolean) {
  const hostedTools = webSearch ? [{ type: "web_search" }] : [];
  const functionTools = (tools ?? []).map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  return [...hostedTools, ...functionTools];
}

export async function toResponsesInput(messages: ChatMessage[]): Promise<unknown[]> {
  const input: unknown[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      input.push(await toResponsesUserInput(message));
      continue;
    }

    if (message.role === "assistant") {
      input.push(...toResponsesAssistantInput(message));
      continue;
    }

    input.push(toResponsesToolOutput(message));
  }

  return input;
}

async function toResponsesUserInput(
  message: Extract<ChatMessage, { role: "user" }>,
): Promise<unknown> {
  const content = await toOpenAIResponsesUserContent(message.content);

  if (isMessageContentPartArray(message.content)) {
    return {
      type: "message",
      role: "user",
      content,
    };
  }

  return {
    role: "user",
    content,
  };
}

function toResponsesAssistantInput(
  message: Extract<ChatMessage, { role: "assistant" }>,
): unknown[] {
  const input: unknown[] = [];

  if (message.toolCalls?.length) {
    if (message.content.trim()) {
      input.push(toResponsesAssistantTextMessage(message.content));
    }

    if (message.providerContent?.length) {
      input.push(...message.providerContent.filter(isNonFunctionCallProviderItem));
    }

    input.push(
      ...message.toolCalls.map((call) => ({
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      })),
    );

    return input;
  }

  if (message.providerContent?.length) {
    input.push(...message.providerContent);
    return input;
  }

  if (message.content.trim()) {
    input.push(toResponsesAssistantTextMessage(message.content));
  }

  return input;
}

function toResponsesAssistantTextMessage(content: string) {
  return {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: content }],
  };
}

function isNonFunctionCallProviderItem(item: unknown): item is ResponseItem {
  const record = readRecord(item);
  return "type" in record && record.type !== "function_call";
}

function toResponsesToolOutput(
  message: Extract<ChatMessage, { role: "tool" }>,
) {
  return {
    type: "function_call_output",
    call_id: message.toolCallId,
    output: message.content,
  };
}

function parseResponsesOutput(
  output: ResponseItem[],
  handlers?: StreamChatHandlers,
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number },
): ChatCompletionResult {
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const item of output) {
    if (item.type === "reasoning") {
      const summaryText = extractReasoningSummaryText(item);

      if (summaryText) {
        thinkingParts.push(summaryText);
      }

      continue;
    }

    if (item.type === "message") {
      const content = item.content;

      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            block.type === "output_text" &&
            typeof block.text === "string"
          ) {
            textParts.push(block.text);
          }
        }
      }
    }

    if (item.type === "web_search_call") {
      emitWebSearchToolEvent(item, handlers);
    }

    if (item.type === "function_call") {
      toolCalls.push({
        id: String(item.call_id ?? item.id ?? ""),
        name: String(item.name ?? ""),
        arguments: parseJsonRecord(String(item.arguments ?? "{}")),
      });
    }
  }

  const content = textParts.join("").trim();
  const thinking = thinkingParts.join("\n\n").trim();
  const providerContent = output.length > 0 ? output : undefined;
  const normalizedUsage = buildTokenUsage({
    inputTokens: usage?.input_tokens,
    outputTokens: usage?.output_tokens,
    totalTokens: usage?.total_tokens,
  });

  if (!content && toolCalls.length === 0 && !providerContent?.length) {
    throw new Error("OpenAI returned an empty response.");
  }

  return {
    content,
    toolCalls,
    assistantMessage: {
      role: "assistant",
      content,
      ...(thinking ? { thinking } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(providerContent ? { providerContent } : {}),
    },
    ...(normalizedUsage ? { usage: normalizedUsage } : {}),
  };
}

function extractReasoningSummaryText(item: ResponseItem): string | undefined {
  const summary = item.summary;

  if (!Array.isArray(summary)) {
    return undefined;
  }

  const parts: string[] = [];

  for (const entry of summary) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      "text" in entry &&
      typeof (entry as { text?: unknown }).text === "string"
    ) {
      const text = (entry as { text: string }).text.trim();

      if (text) {
        parts.push(text);
      }
    }
  }

  const combined = parts.join("\n\n").trim();
  return combined || undefined;
}

function emitWebSearchToolEvent(
  item: ResponseItem,
  handlers?: StreamChatHandlers,
): void {
  const action = readRecord(item.action);
  const toolCallId = String(item.id ?? "");

  handlers?.onToolStart?.({
    toolCallId,
    tool: WEB_SEARCH_TOOL_NAME,
    input: action,
  });
  handlers?.onToolEnd?.({
    toolCallId,
    tool: WEB_SEARCH_TOOL_NAME,
    result: action,
  });
}

async function readOpenAIResponsesStream(
  body: ReadableStream<Uint8Array>,
  handlers?: StreamChatHandlers,
): Promise<ChatCompletionResult> {
  let content = "";
  let thinking = "";
  let usage: ChatCompletionResult["usage"];
  const output: ResponseItem[] = [];
  const outputIndex = new Map<string, ResponseItem>();

  await readSseEvents(body, ({ data }) => {
    const payload = JSON.parse(data) as Record<string, unknown>;
    const type = String(payload.type ?? "");
    const responseRecord = readRecord(payload.response);
    usage =
      buildTokenUsage({
        inputTokens: responseRecord.usage && readRecord(responseRecord.usage).input_tokens,
        outputTokens: responseRecord.usage && readRecord(responseRecord.usage).output_tokens,
        totalTokens: responseRecord.usage && readRecord(responseRecord.usage).total_tokens,
      }) ?? usage;

    if (type === "response.output_text.delta") {
      const delta = String(payload.delta ?? "");
      content += delta;
      handlers?.onChunk(delta);
    }

    if (type === "response.reasoning_summary_text.delta") {
      const delta = String(payload.delta ?? "");
      thinking += delta;
      handlers?.onThinking?.(delta);
    }

    if (type === "response.output_item.added") {
      const item = readRecord(payload.item);
      const itemId = String(item.id ?? "");

      if (itemId) {
        outputIndex.set(itemId, item);
      }
    }

    if (type === "response.output_item.done") {
      const item = readRecord(payload.item);
      const itemId = String(item.id ?? "");
      output.push(item);

      if (itemId) {
        outputIndex.set(itemId, item);
      }

      if (item.type === "web_search_call") {
        emitWebSearchToolEvent(item, handlers);
      }
    }
  });

  if (output.length === 0 && outputIndex.size > 0) {
    output.push(...outputIndex.values());
  }

  const parsed = parseResponsesOutput(output, handlers);

  const thinkingText = thinking.trim() || parsed.assistantMessage.thinking;

  return {
    ...parsed,
    content: content.trim() || parsed.content,
    ...(usage ? { usage } : {}),
    assistantMessage: {
      ...parsed.assistantMessage,
      content: content.trim() || parsed.content,
      ...(thinkingText ? { thinking: thinkingText } : {}),
    },
  };
}
