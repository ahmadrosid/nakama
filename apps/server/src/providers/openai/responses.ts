import type {
  ChatCompletionResult,
  ChatMessage,
  CustomModelEntry,
  GenerateChatInput,
  LlmToolDefinition,
  StreamChatHandlers,
  ThinkingEffort,
  ToolCall,
} from "@nakama/core";
import {
  fetchWithoutIdleTimeout,
  isMessageContentPartArray,
  toOpenAIResponsesUserContent,
  WEB_SEARCH_TOOL_NAME,
} from "@nakama/core";
import { z } from "zod";
import {
  buildTokenUsage,
  formatHttpErrorBody,
  normalizeThinkingEffort,
  parseJsonRecord,
  readRecord,
  readSseEvents,
} from "../shared";
import { openAIModelSupportsThinking } from "./thinking";

const responseContentPartSchema = z
  .object({
    text: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

const responseItemSchema = z
  .object({
    action: z.unknown().optional(),
    arguments: z.string().optional(),
    call_id: z.string().optional(),
    content: z.array(responseContentPartSchema).optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    summary: z.array(responseContentPartSchema).optional(),
    type: z.string(),
  })
  .passthrough();

const responsePayloadSchema = z.object({
  output: z.array(responseItemSchema).optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .nullish(),
});

const responseEventSchema = z.object({
  delta: z.string().optional(),
  item: responseItemSchema.optional(),
  // Lifecycle events (response.created, response.in_progress) send these as null.
  response: z
    .object({
      error: z.object({ message: z.unknown().optional() }).nullish(),
      incomplete_details: z
        .object({ reason: z.unknown().optional() })
        .nullish(),
      output: z.array(responseItemSchema).optional(),
      usage: responsePayloadSchema.shape.usage,
    })
    .optional(),
  type: z.string(),
});

type ResponseItem = z.infer<typeof responseItemSchema>;

type ResponsesContentPart =
  | { text: string; type: "input_text" }
  | { image_url: string; type: "input_image" }
  | { file_data: string; filename: string; type: "input_file" };

type ResponsesInputItem =
  | { content: string | ResponsesContentPart[]; role: "user"; type?: "message" }
  | {
      content: Array<{ text: string; type: "output_text" }>;
      role: "assistant";
      type: "message";
    }
  | { arguments: string; call_id: string; name: string; type: "function_call" }
  | { call_id: string; output: string; type: "function_call_output" }
  | ResponseItem;

type ResponsesTool =
  | { type: "web_search" }
  | {
      description: string;
      name: string;
      parameters: LlmToolDefinition["parameters"];
      type: "function";
    };

type OpenAIResponsesRequestBody = {
  input: ResponsesInputItem[];
  instructions: string;
  model: string;
  store: false;
  tools?: ResponsesTool[];
  reasoning?: { effort: ThinkingEffort; summary: "auto" };
  text?: { format: { type: "json_object" } };
  stream?: true;
};

const DEFAULT_OPENAI_RESPONSES_BASE_URL = "https://api.openai.com/v1";

export async function generateOpenAIResponsesChat(options: {
  apiKey: string;
  /** Endpoint root, without `/responses`. Defaults to the OpenAI API. */
  baseUrl?: string;
  model: string;
  input: GenerateChatInput;
  /** Prefixes request errors. Defaults to the OpenAI provider label. */
  label?: string;
  stream: boolean;
  handlers?: StreamChatHandlers;
  customModels?: CustomModelEntry[];
  /** Asks the model for a JSON object, mirroring chat `response_format`. */
  jsonOutput?: boolean;
  extraHeaders?: Record<string, string>;
  /**
   * Overrides the OpenAI model-id heuristic. Compatible endpoints serve model
   * ids the heuristic has never seen, and it answers false for those.
   */
  supportsThinking?: boolean;
}): Promise<ChatCompletionResult> {
  const label = options.label ?? "OpenAI";
  const baseUrl = options.baseUrl ?? DEFAULT_OPENAI_RESPONSES_BASE_URL;

  const body = await buildResponsesRequestBody(
    options.model,
    options.input,
    options.stream,
    options.customModels,
    options.supportsThinking,
    options.jsonOutput
  );

  const response = await fetchWithoutIdleTimeout(`${baseUrl}/responses`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      ...(options.extraHeaders ?? {}),
    },
    method: "POST",
    signal: options.input.signal,
  });

  if (!response.ok) {
    throw new Error(
      formatHttpErrorBody(label, response.status, await response.text())
    );
  }

  if (options.stream) {
    if (!response.body) {
      throw new Error(`${label} returned an empty stream.`);
    }

    return readOpenAIResponsesStream(response.body, options.handlers);
  }

  const payload = responsePayloadSchema.parse(await response.json());

  return parseResponsesOutput(
    payload.output ?? [],
    options.handlers,
    payload.usage ?? undefined
  );
}

async function buildResponsesRequestBody(
  model: string,
  input: GenerateChatInput,
  stream: boolean,
  customModels?: CustomModelEntry[],
  supportsThinking?: boolean,
  jsonOutput?: boolean
): Promise<OpenAIResponsesRequestBody> {
  const tools = buildResponsesTools(
    input.tools,
    input.providerOptions?.webSearch ?? false
  );

  const body: OpenAIResponsesRequestBody = {
    input: await toResponsesInput(input.messages),
    instructions: input.system,
    model,
    store: false,
  };

  if (tools.length > 0) {
    body.tools = tools;
  }

  const reasoning = buildOpenAIReasoningRequest(
    model,
    input,
    customModels,
    supportsThinking
  );

  if (reasoning) {
    body.reasoning = reasoning;
  }

  if (jsonOutput) {
    body.text = { format: { type: "json_object" } };
  }

  if (stream) {
    body.stream = true;
  }

  return body;
}

function buildOpenAIReasoningRequest(
  model: string,
  input: GenerateChatInput,
  customModels?: CustomModelEntry[],
  supportsThinking?: boolean
): { effort: ThinkingEffort; summary: "auto" } | undefined {
  const modelSupportsThinking =
    supportsThinking ?? openAIModelSupportsThinking(model, customModels);

  if (!(input.providerOptions?.thinking?.enabled && modelSupportsThinking)) {
    return;
  }

  return {
    effort: normalizeThinkingEffort(input.providerOptions.thinking.effort),
    summary: "auto",
  };
}

function buildResponsesTools(
  tools: LlmToolDefinition[] | undefined,
  webSearch: boolean
): ResponsesTool[] {
  const hostedTools: ResponsesTool[] = webSearch
    ? [{ type: "web_search" }]
    : [];

  const functionTools: ResponsesTool[] = (tools ?? []).map((tool) => ({
    description: tool.description,
    name: tool.name,
    parameters: tool.parameters,
    type: "function" as const,
  }));

  return [...hostedTools, ...functionTools];
}

export async function toResponsesInput(
  messages: ChatMessage[]
): Promise<ResponsesInputItem[]> {
  const input: ResponsesInputItem[] = [];

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
  message: Extract<ChatMessage, { role: "user" }>
): Promise<Extract<ResponsesInputItem, { role: "user" }>> {
  const convertedContent = await toOpenAIResponsesUserContent(message.content);
  // SAFETY: Core emits only input_text, input_image, and input_file parts here.
  const content = convertedContent as string | ResponsesContentPart[];

  if (isMessageContentPartArray(message.content)) {
    return {
      content,
      role: "user",
      type: "message",
    };
  }

  return {
    content,
    role: "user",
  };
}

function toResponsesAssistantInput(
  message: Extract<ChatMessage, { role: "assistant" }>
): ResponsesInputItem[] {
  const input: ResponsesInputItem[] = [];

  const providerContent = message.providerContent?.flatMap((part) => {
    const parsed = responseItemSchema.safeParse(part);

    return parsed.success ? [parsed.data] : [];
  });

  if (message.toolCalls?.length) {
    if (providerContent?.length) {
      // providerContent already carries the assistant message item; pushing
      // message.content as well would replay the same text twice.
      input.push(
        ...providerContent.filter((item) => item.type !== "function_call")
      );
    } else if (message.content.trim()) {
      input.push(toResponsesAssistantTextMessage(message.content));
    }

    input.push(
      ...message.toolCalls.map((call) => ({
        arguments: JSON.stringify(call.arguments),
        call_id: call.id,
        name: call.name,
        type: "function_call",
      }))
    );

    return input;
  }

  if (providerContent?.length) {
    input.push(...providerContent);

    return input;
  }

  if (message.content.trim()) {
    input.push(toResponsesAssistantTextMessage(message.content));
  }

  return input;
}

function toResponsesAssistantTextMessage(
  content: string
): Extract<ResponsesInputItem, { role: "assistant" }> {
  return {
    content: [{ text: content, type: "output_text" }],
    role: "assistant",
    type: "message",
  };
}

function toResponsesToolOutput(
  message: Extract<ChatMessage, { role: "tool" }>
): Extract<ResponsesInputItem, { type: "function_call_output" }> {
  return {
    call_id: message.toolCallId,
    output: message.content,
    type: "function_call_output",
  };
}

function parseResponsesOutput(
  output: ResponseItem[],
  handlers?: StreamChatHandlers,
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  },
  streamContent = ""
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
      for (const block of item.content ?? []) {
        if (block.type === "output_text" && block.text) {
          textParts.push(block.text);
        }
      }
    }

    if (item.type === "web_search_call") {
      emitWebSearchToolEvent(item, handlers);
    }

    if (item.type === "function_call") {
      toolCalls.push({
        arguments: parseJsonRecord(String(item.arguments ?? "{}")),
        id: String(item.call_id ?? item.id ?? ""),
        name: String(item.name ?? ""),
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

  if (
    !(content || streamContent.trim()) &&
    toolCalls.length === 0 &&
    !providerContent?.length
  ) {
    throw new Error("OpenAI returned an empty response.");
  }

  const assistantMessage: Extract<ChatMessage, { role: "assistant" }> = {
    content,
    role: "assistant",
  };

  if (thinking) {
    assistantMessage.thinking = thinking;
  }

  if (toolCalls.length > 0) {
    assistantMessage.toolCalls = toolCalls;
  }

  if (providerContent) {
    assistantMessage.providerContent = providerContent;
  }

  const result: ChatCompletionResult = {
    assistantMessage,
    content,
    toolCalls,
  };

  if (normalizedUsage) {
    result.usage = normalizedUsage;
  }

  return result;
}

function extractReasoningSummaryText(item: ResponseItem): string | undefined {
  const summary = item.summary ?? [];

  const parts: string[] = [];

  for (const entry of summary) {
    if (entry.text) {
      const text = entry.text.trim();

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
  handlers?: StreamChatHandlers
): void {
  const action = readRecord(item.action);
  const toolCallId = String(item.id ?? "");

  handlers?.onToolStart?.({
    input: action,
    tool: WEB_SEARCH_TOOL_NAME,
    toolCallId,
  });
  handlers?.onToolEnd?.({
    result: action,
    tool: WEB_SEARCH_TOOL_NAME,
    toolCallId,
  });
}

async function readOpenAIResponsesStream(
  body: ReadableStream<Uint8Array>,
  handlers?: StreamChatHandlers
): Promise<ChatCompletionResult> {
  let content = "";
  let thinking = "";
  let usage: ChatCompletionResult["usage"];
  const output: ResponseItem[] = [];
  const outputIndex = new Map<string, ResponseItem>();

  await readSseEvents(body, ({ data }) => {
    const payload = responseEventSchema.parse(JSON.parse(data));
    const type = payload.type;
    const responseRecord = payload.response;

    if (type === "response.failed") {
      throw new Error(
        String(responseRecord?.error?.message ?? "OpenAI response failed.")
      );
    }

    if (type === "response.incomplete") {
      throw new Error(
        `OpenAI response incomplete: ${String(responseRecord?.incomplete_details?.reason ?? "unknown reason")}`
      );
    }

    if (
      type === "response.completed" &&
      output.length === 0 &&
      responseRecord?.output
    ) {
      output.push(...responseRecord.output);
    }

    usage =
      buildTokenUsage({
        inputTokens: responseRecord?.usage?.input_tokens,
        outputTokens: responseRecord?.usage?.output_tokens,
        totalTokens: responseRecord?.usage?.total_tokens,
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
      const item = payload.item;

      if (!item) {
        return;
      }

      const itemId = String(item.id ?? "");

      if (itemId) {
        outputIndex.set(itemId, item);
      }
    }

    if (type === "response.output_item.done") {
      const item = payload.item;

      if (!item) {
        return;
      }

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

  const parsed = parseResponsesOutput(output, handlers, undefined, content);

  const thinkingText = thinking.trim() || parsed.assistantMessage.thinking;
  const streamContent = content.trim() || parsed.content;

  const assistantMessage: Extract<ChatMessage, { role: "assistant" }> = {
    ...parsed.assistantMessage,
    content: streamContent,
  };

  if (thinkingText) {
    assistantMessage.thinking = thinkingText;
  }

  const result: ChatCompletionResult = {
    ...parsed,
    assistantMessage,
    content: streamContent,
  };

  if (usage) {
    result.usage = usage;
  }

  return result;
}
