import { formatClientError } from "@tinyclaw/core/api-error";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export function formatError(error: unknown): string {
  return formatClientError(error);
}

export function stripMarkdownForTelegram(text: string): string {
  let result = text.trim();

  result = result.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code: string) => code.trim());
  result = result.replace(/`([^`]+)`/g, "$1");
  result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
  result = result.replace(/\*([^*]+)\*/g, "$1");
  result = result.replace(/__([^_]+)__/g, "$1");
  result = result.replace(/_([^_]+)_/g, "$1");
  result = result.replace(/^#{1,6}\s+/gm, "");
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  return result.trim();
}

export function prepareTelegramReply(text: string): string {
  return stripMarkdownForTelegram(text);
}

export function splitIntoChatBubbles(text: string, maxChars = 400): string[] {
  const trimmed = prepareTelegramReply(text);

  if (!trimmed) {
    return [];
  }

  if (trimmed.length <= maxChars) {
    return splitTelegramMessage(trimmed);
  }

  const paragraphs = trimmed.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
  const merged: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current) {
        merged.push(current);
        current = "";
      }

      for (const chunk of splitLongParagraph(paragraph, maxChars)) {
        merged.push(chunk);
      }

      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      merged.push(current);
    }

    current = paragraph;
  }

  if (current) {
    merged.push(current);
  }

  return merged.flatMap((bubble) => splitTelegramMessage(bubble));
}

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let remaining = paragraph;

  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf(" ", maxChars);

    if (splitAt <= 0) {
      splitAt = maxChars;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

export function splitTelegramMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
    let splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_MESSAGE_LENGTH);

    if (splitAt <= 0) {
      splitAt = TELEGRAM_MAX_MESSAGE_LENGTH;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

export const HELP_TEXT = `TinyClaw Telegram commands:

/help — show this message
/stop — stop the current reply while it is streaming
/clear — clear chat history
/compact — compact conversation history
/new — start a new conversation
/status — server and model status

Send text or a photo (optional caption) to chat with the agent.`;
