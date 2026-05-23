import type {
  ChatCompletionResult,
  ChatMessage,
  GenerateChatInput,
  LlmToolDefinition,
  StreamChatHandlers,
  ToolCall,
} from "@tinyclaw/core";
import { WEB_SEARCH_TOOL_NAME } from "@tinyclaw/core";

const MAX_PAUSE_CONTINUATIONS = 5;
const WEB_SEARCH_MAX_USES = 5;

type AnthropicContentBlock = Record<string, unknown>;

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

export function buildAnthropicTools(
  tools: LlmToolDefinition[] | undefined,
  webSearch: boolean,
): unknown[] | undefined {
  const customTools = tools?.length ? tools.map(toAnthropicCustomTool) : [];
  const hostedTools = webSearch
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

export function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      result.push({ role: "user", content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      if (message.providerContent?.length) {
        result.push({
          role: "assistant",
          content: message.providerContent as AnthropicContentBlock[],
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
        content: blocks.length > 0 ? blocks : message.content,
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
      last.content.push(toolResult);
      continue;
    }

    result.push({
      role: "user",
      content: [toolResult],
    });
  }

  return result;
}

export function parseAnthropicContent(
  content: AnthropicContentBlock[] | undefined,
): ChatCompletionResult {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of content ?? []) {
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
  const providerContent = content?.length ? content : undefined;

  return {
    content: contentText,
    toolCalls,
    assistantMessage: {
      role: "assistant",
      content: contentText,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(providerContent ? { providerContent } : {}),
    },
  };
}

export async function continueAnthropicUntilDone(options: {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: LlmToolDefinition[];
  webSearch: boolean;
  stream: boolean;
  handlers?: StreamChatHandlers;
}): Promise<ChatCompletionResult> {
  let apiMessages = toAnthropicMessages(options.messages);
  let combinedContent: AnthropicContentBlock[] = [];

  for (let attempt = 0; attempt < MAX_PAUSE_CONTINUATIONS; attempt += 1) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": options.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: 4096,
        system: options.system,
        messages: apiMessages,
        ...(buildAnthropicTools(options.tools, options.webSearch)
          ? { tools: buildAnthropicTools(options.tools, options.webSearch) }
          : {}),
        ...(options.stream ? { stream: true } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Anthropic request failed (${response.status}): ${await response.text()}`,
      );
    }

    if (options.stream) {
      if (!response.body) {
        throw new Error("Anthropic returned an empty stream.");
      }

      const streamed = await readAnthropicStream(response.body, options.handlers);
      combinedContent.push(...(streamed.assistantMessage.providerContent ?? []));

      if (streamed.stopReason !== "pause_turn") {
        return finalizeAnthropicResult(streamed.content, streamed.toolCalls, combinedContent);
      }

      apiMessages = [
        ...apiMessages,
        { role: "assistant", content: combinedContent },
      ];
      continue;
    }

    const payload = (await response.json()) as {
      content?: AnthropicContentBlock[];
      stop_reason?: string;
    };

    emitHostedToolEvents(payload.content, options.handlers);
    combinedContent.push(...(payload.content ?? []));

    if (payload.stop_reason !== "pause_turn") {
      return finalizeAnthropicResult(
        parseAnthropicContent(combinedContent).content,
        parseAnthropicContent(combinedContent).toolCalls,
        combinedContent,
      );
    }

    apiMessages = [
      ...apiMessages,
      { role: "assistant", content: combinedContent },
    ];
  }

  return parseAnthropicContent(combinedContent);
}

interface StreamedAnthropicResult extends ChatCompletionResult {
  stopReason?: string;
}

async function readAnthropicStream(
  body: ReadableStream<Uint8Array>,
  handlers?: StreamChatHandlers,
): Promise<StreamedAnthropicResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let stopReason: string | undefined;
  const pending = new Map<number, { id: string; name: string; inputJson: string }>();
  const providerContent: AnthropicContentBlock[] = [];
  const contentBlocks = new Map<number, AnthropicContentBlock>();

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
      let eventName = "message";
      let eventData = "";

      for (const line of eventBlock.split("\n")) {
        if (line.startsWith("event: ")) {
          eventName = line.slice(7).trim();
          continue;
        }

        if (line.startsWith("data: ")) {
          eventData = line.slice(6);
        }
      }

      if (!eventData) {
        continue;
      }

      const payload = JSON.parse(eventData) as Record<string, unknown>;

      if (eventName === "message_delta" || payload.type === "message_delta") {
        const delta = payload.delta as { stop_reason?: string } | undefined;
        stopReason = delta?.stop_reason ?? stopReason;
      }

      if (
        eventName === "content_block_start" ||
        payload.type === "content_block_start"
      ) {
        const index = Number(payload.index ?? 0);
        const block = payload.content_block as AnthropicContentBlock | undefined;

        if (block) {
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
      }

      if (
        eventName === "content_block_delta" ||
        payload.type === "content_block_delta"
      ) {
        const index = Number(payload.index ?? 0);
        const delta = payload.delta as Record<string, unknown> | undefined;

        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          content += delta.text;
          handlers?.onChunk(delta.text);

          const block = contentBlocks.get(index) ?? { type: "text", text: "" };
          block.text = `${String(block.text ?? "")}${delta.text}`;
          contentBlocks.set(index, block);
          providerContent[index] = block;
        }

        if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
          const current = pending.get(index) ?? { id: "", name: "", inputJson: "" };
          current.inputJson += delta.partial_json;
          pending.set(index, current);
        }
      }

      if (
        eventName === "content_block_stop" ||
        payload.type === "content_block_stop"
      ) {
        const index = Number(payload.index ?? 0);
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
  }

  const toolCalls = [...pending.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, call]) => call)
    .flatMap((call) => {
      if (!call.id || !call.name) {
        return [];
      }

      let argumentsValue: Record<string, unknown> = {};

      if (call.inputJson.trim()) {
        try {
          const parsed = JSON.parse(call.inputJson) as unknown;
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            argumentsValue = parsed as Record<string, unknown>;
          }
        } catch {
          argumentsValue = {};
        }
      }

      return [
        {
          id: call.id,
          name: call.name,
          arguments: argumentsValue,
        },
      ];
    });

  const normalizedContent = providerContent.filter(Boolean);
  const parsed = parseAnthropicContent(normalizedContent);

  return {
    ...parsed,
    content: content.trim() || parsed.content,
    toolCalls,
    stopReason,
    assistantMessage: {
      role: "assistant",
      content: content.trim() || parsed.content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(normalizedContent.length > 0 ? { providerContent: normalizedContent } : {}),
    },
  };
}

function finalizeAnthropicResult(
  content: string,
  toolCalls: ToolCall[],
  providerContent: AnthropicContentBlock[],
): ChatCompletionResult {
  if (!content.trim() && toolCalls.length === 0 && providerContent.length === 0) {
    throw new Error("Anthropic returned an empty response.");
  }

  return {
    content,
    toolCalls,
    assistantMessage: {
      role: "assistant",
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(providerContent.length > 0 ? { providerContent } : {}),
    },
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

function toAnthropicCustomTool(tool: LlmToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
