import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageCreateParams,
  MessageParam,
  RawMessageStreamEvent,
  ToolUnion,
} from "@anthropic-ai/sdk/resources/messages/messages";
import type {
  ChatCompletionResult,
  ChatMessage,
  GenerateChatInput,
  LlmToolDefinition,
  ProviderName,
  StreamChatHandlers,
  ToolCall,
} from "@nakama/core";
import { toAnthropicUserContent, WEB_SEARCH_TOOL_NAME } from "@nakama/core";
import {
  buildTokenUsage,
  normalizeThinkingEffort,
  notifyToolInputDelta,
  parseJsonRecord,
  readRecord,
} from "../shared";

const MAX_PAUSE_CONTINUATIONS = 5;
const WEB_SEARCH_MAX_USES = 5;

type AnthropicContentBlock = Record<string, unknown>;

export function buildAnthropicTools(
  tools: LlmToolDefinition[] | undefined,
  webSearch: boolean,
): ToolUnion[] | undefined {
  const customTools = tools?.length ? tools.map(toAnthropicCustomTool) : [];
  const hostedTools: ToolUnion[] = webSearch
    ? [
        {
          type: "web_search_20250305",
          name: WEB_SEARCH_TOOL_NAME,
          max_uses: WEB_SEARCH_MAX_USES,
        },
      ]
    : [];

  const combined = [...hostedTools, ...customTools];

  return combined.length > 0 ? combined : undefined;
}

export async function toAnthropicMessages(
  messages: ChatMessage[],
  provider: ProviderName = "anthropic",
): Promise<MessageParam[]> {
  const result: MessageParam[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      result.push({
        role: "user",
        content: (await toAnthropicUserContent(message.content, provider)) as MessageParam["content"],
      });
      continue;
    }

    if (message.role === "assistant") {
      if (message.providerContent?.length) {
        result.push({
          role: "assistant",
          content: message.providerContent as MessageParam["content"],
        });
        continue;
      }

      const blocks: AnthropicContentBlock[] = [];

      if (message.content.trim()) {
        blocks.push({ type: "text", text: message.content });
      }

      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }

      result.push({
        role: "assistant",
        content: (blocks.length > 0 ? blocks : message.content) as MessageParam["content"],
      });
      continue;
    }

    const last = result[result.length - 1];
    const toolResult: AnthropicContentBlock = {
      type: "tool_result",
      tool_use_id: message.toolCallId,
      content: message.content,
    };

    if (last?.role === "user" && Array.isArray(last.content)) {
      (last.content as unknown as AnthropicContentBlock[]).push(toolResult);
      continue;
    }

    result.push({
      role: "user",
      content: [toolResult] as unknown as MessageParam["content"],
    });
  }

  return result;
}

export function parseAnthropicContent(
  content: AnthropicContentBlock[] | undefined,
): ChatCompletionResult {
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of content ?? []) {
    if (block.type === "thinking" && typeof block.thinking === "string") {
      thinkingParts.push(block.thinking);
      continue;
    }

    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
      continue;
    }

    if (block.type === "tool_use") {
      toolCalls.push({
        id: String(block.id ?? ""),
        name: String(block.name ?? ""),
        arguments: readRecord(block.input),
      });
    }
  }

  const contentText = textParts.join("").trim();
  const thinkingText = thinkingParts.join("").trim();
  const providerContent = content?.length ? content : undefined;

  return {
    content: contentText,
    toolCalls,
    assistantMessage: {
      role: "assistant",
      content: contentText,
      ...(thinkingText ? { thinking: thinkingText } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(providerContent ? { providerContent } : {}),
    },
  };
}

export interface ContinueAnthropicUntilDoneOptions {
  client: Anthropic;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: LlmToolDefinition[];
  webSearch: boolean;
  thinking?: GenerateChatInput["providerOptions"];
  stream: boolean;
  handlers?: StreamChatHandlers;
  provider?: ProviderName;
}

export async function continueAnthropicUntilDone(
  options: ContinueAnthropicUntilDoneOptions,
): Promise<ChatCompletionResult> {
  let apiMessages = await toAnthropicMessages(options.messages, options.provider);
  let combinedContent: AnthropicContentBlock[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const tools = buildAnthropicTools(options.tools, options.webSearch);
  const thinkingRequest = buildAnthropicThinkingRequest(options.thinking);
  const requestBase = {
    model: options.model,
    max_tokens: 4096,
    system: options.system,
    messages: apiMessages,
    ...(tools ? { tools } : {}),
    ...thinkingRequest,
  };

  for (let attempt = 0; attempt < MAX_PAUSE_CONTINUATIONS; attempt += 1) {
    if (options.stream) {
      const stream = await options.client.messages.create({
        ...requestBase,
        messages: apiMessages,
        stream: true,
      });

      const streamed = await readAnthropicStream(stream, options.handlers);
      totalInputTokens += streamed.usage?.inputTokens ?? 0;
      totalOutputTokens += streamed.usage?.outputTokens ?? 0;
      combinedContent.push(
        ...((streamed.assistantMessage.providerContent ?? []) as AnthropicContentBlock[]),
      );

      if (streamed.stopReason !== "pause_turn") {
        return finalizeAnthropicResult({
          parsed: parseAnthropicContent(combinedContent),
          content: streamed.content,
          toolCalls: streamed.toolCalls,
          usage: buildTokenUsage({
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          }),
        });
      }

      apiMessages = appendAnthropicAssistantMessage(apiMessages, combinedContent);
      continue;
    }

    const payload = await options.client.messages.create({
      ...requestBase,
      messages: apiMessages,
    });
    totalInputTokens += payload.usage?.input_tokens ?? 0;
    totalOutputTokens += payload.usage?.output_tokens ?? 0;

    const content = payload.content as unknown as AnthropicContentBlock[];
    emitHostedToolEvents(content, options.handlers);
    combinedContent.push(...content);

    if (payload.stop_reason !== "pause_turn") {
      return finalizeAnthropicResult({
        parsed: parseAnthropicContent(combinedContent),
        usage: buildTokenUsage({
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        }),
      });
    }

    apiMessages = appendAnthropicAssistantMessage(apiMessages, combinedContent);
  }

  return finalizeAnthropicResult({
    parsed: parseAnthropicContent(combinedContent),
    usage: buildTokenUsage({
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    }),
  });
}

interface StreamedAnthropicResult extends ChatCompletionResult {
  stopReason?: string;
}

async function readAnthropicStream(
  stream: AsyncIterable<RawMessageStreamEvent>,
  handlers?: StreamChatHandlers,
): Promise<StreamedAnthropicResult> {
  let content = "";
  let stopReason: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const pending = new Map<number, { id: string; name: string; inputJson: string }>();
  const providerContent: AnthropicContentBlock[] = [];
  const contentBlocks = new Map<number, AnthropicContentBlock>();

  for await (const event of stream) {
    if (event.type === "message_start") {
      const messageUsage = readRecord(
        (event as unknown as { message?: { usage?: Record<string, unknown> } }).message?.usage,
      );
      if (typeof messageUsage.input_tokens === "number") {
        inputTokens = messageUsage.input_tokens;
      }

      if (typeof messageUsage.output_tokens === "number") {
        outputTokens = messageUsage.output_tokens;
      }
    }

    if (event.type === "message_delta") {
      stopReason = event.delta.stop_reason ?? stopReason;
      const deltaUsage = readRecord(
        (event as unknown as { delta?: { usage?: Record<string, unknown> } }).delta?.usage,
      );
      if (typeof deltaUsage.input_tokens === "number") {
        inputTokens = deltaUsage.input_tokens;
      }

      if (typeof deltaUsage.output_tokens === "number") {
        outputTokens = deltaUsage.output_tokens;
      }
    }

    if (event.type === "content_block_start") {
      const index = event.index;
      const block = event.content_block as unknown as AnthropicContentBlock;

      contentBlocks.set(index, { ...block });
      providerContent[index] = { ...block };

      if (block.type === "tool_use") {
        pending.set(index, {
          id: String(block.id ?? ""),
          name: String(block.name ?? ""),
          inputJson: "",
        });
      }

      if (block.type === "server_tool_use") {
        handlers?.onToolStart?.({
          toolCallId: String(block.id ?? ""),
          tool: String(block.name ?? WEB_SEARCH_TOOL_NAME),
          input: readRecord(block.input),
        });
      }
    }

    if (event.type === "content_block_delta") {
      const index = event.index;
      const delta = event.delta;

      if (delta.type === "thinking_delta") {
        handlers?.onThinking?.(delta.thinking);

        const block = contentBlocks.get(index) ?? { type: "thinking", thinking: "" };
        block.thinking = `${String(block.thinking ?? "")}${delta.thinking}`;
        contentBlocks.set(index, block);
        providerContent[index] = block;
      }

      if (delta.type === "text_delta") {
        content += delta.text;
        handlers?.onChunk(delta.text);

        const block = contentBlocks.get(index) ?? { type: "text", text: "" };
        block.text = `${String(block.text ?? "")}${delta.text}`;
        contentBlocks.set(index, block);
        providerContent[index] = block;
      }

      if (delta.type === "input_json_delta") {
        const current = pending.get(index) ?? { id: "", name: "", inputJson: "" };
        const partial = delta.partial_json;
        current.inputJson += partial;
        pending.set(index, current);
        notifyToolInputDelta(handlers, {
          id: current.id,
          name: current.name,
          arguments: current.inputJson,
        }, partial);
      }
    }

    if (event.type === "content_block_stop") {
      const index = event.index;
      const block = providerContent[index];

      if (block?.type === "web_search_tool_result") {
        handlers?.onToolEnd?.({
          toolCallId: String(block.tool_use_id ?? ""),
          tool: WEB_SEARCH_TOOL_NAME,
          result: block.content ?? block,
        });
      }
    }
  }

  const toolCalls = finalizeAnthropicToolCalls(pending);
  const normalizedContent = providerContent.filter(Boolean);
  const parsed = parseAnthropicContent(normalizedContent);

  return {
    ...finalizeAnthropicResult({
      parsed,
      content,
      toolCalls,
      usage: buildTokenUsage({ inputTokens, outputTokens }),
    }),
    stopReason,
  };
}

function buildAnthropicThinkingRequest(
  providerOptions: GenerateChatInput["providerOptions"],
): Pick<MessageCreateParams, "thinking" | "output_config"> {
  if (!providerOptions?.thinking?.enabled) {
    return {};
  }

  const effort = normalizeThinkingEffort(providerOptions.thinking.effort);

  return {
    thinking: { type: "adaptive" },
    output_config: { effort },
  };
}

function emitHostedToolEvents(
  content: AnthropicContentBlock[] | undefined,
  handlers?: StreamChatHandlers,
): void {
  if (!content?.length || !handlers) {
    return;
  }

  for (const block of content) {
    if (block.type === "server_tool_use") {
      handlers.onToolStart?.({
        toolCallId: String(block.id ?? ""),
        tool: String(block.name ?? WEB_SEARCH_TOOL_NAME),
        input: readRecord(block.input),
      });
    }

    if (block.type === "web_search_tool_result") {
      handlers.onToolEnd?.({
        toolCallId: String(block.tool_use_id ?? ""),
        tool: WEB_SEARCH_TOOL_NAME,
        result: block.content ?? block,
      });
    }
  }
}

function toAnthropicCustomTool(tool: LlmToolDefinition): ToolUnion {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as never,
  };
}

function appendAnthropicAssistantMessage(
  messages: MessageParam[],
  content: AnthropicContentBlock[],
): MessageParam[] {
  return [
    ...messages,
    { role: "assistant", content: content as unknown as MessageParam["content"] },
  ];
}

function finalizeAnthropicToolCalls(
  pending: Map<number, { id: string; name: string; inputJson: string }>,
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
          arguments: parseJsonRecord(call.inputJson),
        },
      ];
    });
}

function finalizeAnthropicResult(options: {
  parsed: ChatCompletionResult;
  content?: string;
  toolCalls?: ToolCall[];
  usage?: ChatCompletionResult["usage"];
}): ChatCompletionResult {
  const content = options.content?.trim() || options.parsed.content;
  const toolCalls = options.toolCalls ?? options.parsed.toolCalls;
  const providerContent = options.parsed.assistantMessage.providerContent;

  if (!content && toolCalls.length === 0 && !providerContent?.length) {
    throw new Error("Anthropic returned an empty response.");
  }

  return {
    ...options.parsed,
    content,
    toolCalls,
    ...(options.usage ? { usage: options.usage } : {}),
    assistantMessage: {
      ...options.parsed.assistantMessage,
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(providerContent?.length ? { providerContent } : {}),
    },
  };
}
