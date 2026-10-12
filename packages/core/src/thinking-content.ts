import { z } from "zod";
import type { ChatMessage, JsonValue } from "./contract";

type JsonObject = Record<string, JsonValue>;

const JsonObjectSchema = z.record(z.string(), z.json());

const ReasoningSummarySchema = z.array(
  z.object({ text: z.string().optional() })
);

function asRecord(value: JsonValue): JsonObject | null {
  const parsed = JsonObjectSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

function readTrimmedText(value: JsonValue | undefined): string | undefined {
  const parsed = z.string().safeParse(value);

  if (!parsed.success) {
    return;
  }

  const text = parsed.data.trim();

  return text || undefined;
}

function extractThinkingBlockText(block: JsonObject): string | undefined {
  return block.type === "thinking"
    ? readTrimmedText(block.thinking)
    : undefined;
}

function extractReasoningSummaryTexts(block: JsonObject): string[] {
  if (block.type !== "reasoning") {
    return [];
  }

  const summary = ReasoningSummarySchema.safeParse(block.summary);

  if (!summary.success) {
    return [];
  }

  return summary.data.flatMap(({ text }) => {
    const parsedText = z.string().safeParse(text);
    const trimmed = parsedText.success ? parsedText.data.trim() : "";

    return trimmed ? [trimmed] : [];
  });
}

export function extractThinkingFromAssistantMessage(
  message: Extract<ChatMessage, { role: "assistant" }>
): string | undefined {
  const direct = message.thinking?.trim();

  if (direct) {
    return direct;
  }

  const parsed = z.array(z.json()).safeParse(message.providerContent);

  return parsed.success
    ? extractThinkingFromProviderContent(parsed.data)
    : undefined;
}

export function extractThinkingFromProviderContent(
  content: JsonValue[] | undefined
): string | undefined {
  if (!content?.length) {
    return;
  }

  const parts: string[] = [];

  for (const item of content) {
    const block = asRecord(item);

    if (!block) {
      continue;
    }

    const thinkingText = extractThinkingBlockText(block);

    if (thinkingText) {
      parts.push(thinkingText);
      continue;
    }

    parts.push(...extractReasoningSummaryTexts(block));
  }

  const combined = parts.join("\n\n").trim();

  return combined || undefined;
}
