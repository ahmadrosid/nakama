import type { ChatCompletionResult, ChatMessage, GenerateChatInput } from "@nakama/core";

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicRequestMessage[];
  system?: string | AnthropicTextBlock[];
  stream?: boolean;
  tools?: unknown[];
}

interface AnthropicRequestMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

type AnthropicContentBlock = AnthropicTextBlock | Record<string, unknown>;

export function parseAnthropicMessagesRequest(body: unknown): AnthropicMessagesRequest {
  if (typeof body !== "object" || body === null) {
    throw new Error("Invalid Anthropic messages request.");
  }

  const record = body as Record<string, unknown>;
  const model = typeof record.model === "string" ? record.model.trim() : "";

  if (!model) {
    throw new Error("model is required.");
  }

  const maxTokens = record.max_tokens;

  if (typeof maxTokens !== "number" || !Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw new Error("max_tokens is required.");
  }

  if (!Array.isArray(record.messages) || record.messages.length === 0) {
    throw new Error("messages are required.");
  }

  if (Array.isArray(record.tools) && record.tools.length > 0) {
    throw new Error("Tool calling is not supported on the inference gateway yet.");
  }

  return {
    model,
    max_tokens: maxTokens,
    messages: record.messages as AnthropicRequestMessage[],
    ...(record.system !== undefined ? { system: record.system as AnthropicMessagesRequest["system"] } : {}),
    ...(record.stream === true ? { stream: true } : {}),
  };
}

export function anthropicRequestToGenerateChatInput(
  request: AnthropicMessagesRequest,
): GenerateChatInput {
  return {
    system: extractSystemPrompt(request.system),
    messages: request.messages.flatMap(toChatMessages),
  };
}

export function buildAnthropicMessageResponse(
  request: AnthropicMessagesRequest,
  result: ChatCompletionResult,
): Record<string, unknown> {
  const text = result.content.trim() || result.assistantMessage.content.trim();

  return {
    id: `msg_${crypto.randomUUID().replace(/-/g, "")}`,
    type: "message",
    role: "assistant",
    model: request.model,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: result.usage?.inputTokens ?? 0,
      output_tokens: result.usage?.outputTokens ?? 0,
    },
  };
}

export function createAnthropicStreamResponse(
  request: AnthropicMessagesRequest,
  onStream: (handlers: { onChunk: (delta: string) => void }) => Promise<ChatCompletionResult>,
): Response {
  const encoder = new TextEncoder();
  const messageId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("message_start", {
        type: "message_start",
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          model: request.model,
          content: [],
          stop_reason: null,
          usage: null,
        },
      });

      send("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      });

      const result = await onStream({
        onChunk(delta) {
          send("content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: delta },
          });
        },
      });

      send("content_block_stop", {
        type: "content_block_stop",
        index: 0,
      });

      send("message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: "end_turn",
          stop_sequence: null,
        },
        usage: {
          input_tokens: result.usage?.inputTokens ?? 0,
          output_tokens: result.usage?.outputTokens ?? 0,
        },
      });

      send("message_stop", {
        type: "message_stop",
      });

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function extractSystemPrompt(system: AnthropicMessagesRequest["system"]): string {
  if (!system) {
    return "";
  }

  if (typeof system === "string") {
    return system;
  }

  return system
    .filter((block): block is AnthropicTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function toChatMessages(message: AnthropicRequestMessage): ChatMessage[] {
  const content = extractTextContent(message.content);

  if (message.role === "user") {
    return [{ role: "user", content }];
  }

  return [{ role: "assistant", content }];
}

function extractTextContent(content: string | AnthropicContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((block): block is AnthropicTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}
