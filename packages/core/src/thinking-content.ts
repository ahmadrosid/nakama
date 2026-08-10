import type { ChatMessage } from "./contract";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readTrimmedText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return;
  }

  const text = value.trim();
  return text || undefined;
}

function extractThinkingBlockText(
  block: Record<string, unknown>
): string | undefined {
  return block.type === "thinking"
    ? readTrimmedText(block.thinking)
    : undefined;
}

function extractReasoningSummaryTexts(
  block: Record<string, unknown>
): string[] {
  if (block.type !== "reasoning" || !Array.isArray(block.summary)) {
    return [];
  }

  return block.summary
    .map((entry) => asRecord(entry))
    .flatMap((entry) => {
      if (!entry) {
        return [];
      }

      const text = readTrimmedText(entry.text);
      return text ? [text] : [];
    });
}

export function extractThinkingFromAssistantMessage(
  message: Extract<ChatMessage, { role: "assistant" }>
): string | undefined {
  const direct = message.thinking?.trim();

  if (direct) {
    return direct;
  }

  return extractThinkingFromProviderContent(message.providerContent);
}

export function extractThinkingFromProviderContent(
  content: unknown[] | undefined
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
