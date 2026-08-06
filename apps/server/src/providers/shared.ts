import type {
  ChatCompletionResult,
  ChatMessage,
  StreamChatHandlers,
  ThinkingEffort,
  ToolCall,
} from "@nakama/core";

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function buildTokenUsage(options: {
  inputTokens?: unknown;
  outputTokens?: unknown;
  totalTokens?: unknown;
}): ChatCompletionResult["usage"] | undefined {
  let inputTokens = readNumber(options.inputTokens);
  let outputTokens = readNumber(options.outputTokens);
  let totalTokens = readNumber(options.totalTokens);

  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }

  if (inputTokens === undefined && totalTokens !== undefined && outputTokens !== undefined) {
    inputTokens = Math.max(totalTokens - outputTokens, 0);
  }

  if (outputTokens === undefined && totalTokens !== undefined && inputTokens !== undefined) {
    outputTokens = Math.max(totalTokens - inputTokens, 0);
  }

  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }

  if (totalTokens === undefined) {
    totalTokens = inputTokens + outputTokens;
  }

  return { inputTokens, outputTokens, totalTokens };
}

export function extractOpenAITokenUsage(value: unknown): ChatCompletionResult["usage"] | undefined {
  const record = readRecord(value);
  return buildTokenUsage({
    inputTokens: record.prompt_tokens,
    outputTokens: record.completion_tokens,
    totalTokens: record.total_tokens,
  });
}

export function extractAnthropicTokenUsage(
  value: unknown,
): ChatCompletionResult["usage"] | undefined {
  const record = readRecord(value);
  return buildTokenUsage({
    inputTokens: record.input_tokens,
    outputTokens: record.output_tokens,
  });
}

export function extractGeminiTokenUsage(value: unknown): ChatCompletionResult["usage"] | undefined {
  const record = readRecord(value);
  return buildTokenUsage({
    inputTokens: record.promptTokenCount,
    outputTokens: record.candidatesTokenCount,
    totalTokens: record.totalTokenCount,
  });
}

export function notifyToolInputDelta(
  handlers: StreamChatHandlers | undefined,
  call: { id: string; name: string; arguments: string },
  delta: string,
): void {
  if (!handlers?.onToolInputDelta || !call.id || !call.name || !delta) {
    return;
  }

  handlers.onToolInputDelta({
    toolCallId: call.id,
    tool: call.name,
    delta,
    accumulatedArguments: call.arguments,
  });
}

export function buildChatCompletionResult(options: {
  content: string | null | undefined;
  toolCalls: ToolCall[];
  thinking?: string | null | undefined;
  usage?: ChatCompletionResult["usage"];
}): ChatCompletionResult {
  const content = options.content?.trim() ?? "";
  const thinking = options.thinking?.trim();
  const assistantMessage: Extract<ChatMessage, { role: "assistant" }> = {
    role: "assistant",
    content,
    ...(thinking ? { thinking } : {}),
    ...(options.toolCalls.length > 0 ? { toolCalls: options.toolCalls } : {}),
  };

  return {
    content,
    toolCalls: options.toolCalls,
    assistantMessage,
    ...(options.usage ? { usage: options.usage } : {}),
  };
}

export interface SseEvent {
  event: string;
  data: string;
}

export async function readSseEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void | Promise<void>,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (value) {
      buffer += decoder.decode(value, { stream: true });
    }

    if (done) {
      buffer += decoder.decode();
    }

    while (true) {
      const boundary = findSseBoundary(buffer);

      if (!boundary) {
        break;
      }

      const eventBlock = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      await emitSseEvent(eventBlock, onEvent);
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    await emitSseEvent(buffer, onEvent);
  }
}

async function emitSseEvent(
  eventBlock: string,
  onEvent: (event: SseEvent) => void | Promise<void>,
): Promise<void> {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of eventBlock.split(/\r?\n/)) {
    const eventValue = readSseField(line, "event:");

    if (eventValue !== null) {
      event = eventValue.trim() || "message";
      continue;
    }

    const dataValue = readSseField(line, "data:");

    if (dataValue !== null) {
      dataLines.push(dataValue);
    }
  }

  const data = dataLines.join("\n");
  const normalized = data.trim();

  if (!normalized || normalized === "[DONE]") {
    return;
  }

  await onEvent({ event, data });
}

function findSseBoundary(
  buffer: string,
): { index: number; length: number } | null {
  const match = /\r?\n\r?\n/.exec(buffer);

  if (!match || match.index === undefined) {
    return null;
  }

  return {
    index: match.index,
    length: match[0].length,
  };
}

function readSseField(line: string, prefix: string): string | null {
  if (!line.startsWith(prefix)) {
    return null;
  }

  let value = line.slice(prefix.length);

  if (value.startsWith(" ")) {
    value = value.slice(1);
  }

  return value;
}

export function parseJsonRecord(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();

  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return readRecord(parsed);
  } catch {
    return {};
  }
}

export function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeThinkingEffort(
  effort: ThinkingEffort | undefined,
): ThinkingEffort {
  if (effort === "low" || effort === "medium" || effort === "high") {
    return effort;
  }

  return "medium";
}

export function formatHttpErrorBody(
  label: string,
  status: number,
  body: string,
): string {
  const trimmed = body.trim();

  if (!trimmed) {
    return `${label} request failed (${status}).`;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const nested = parsed.error;

    if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
      const record = nested as Record<string, unknown>;
      const message =
        typeof record.message === "string" ? record.message.trim() : "";
      const type = typeof record.type === "string" ? record.type.trim() : "";

      if (message) {
        return `${label} request failed (${status}${type ? ` ${type}` : ""}): ${message}`;
      }
    }

    const message =
      typeof parsed.message === "string" ? parsed.message.trim() : "";

    if (message) {
      return `${label} request failed (${status}): ${message}`;
    }
  } catch {
    // fall through to raw body
  }

  return `${label} request failed (${status}): ${trimmed.slice(0, 500)}`;
}
