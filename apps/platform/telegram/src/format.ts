import { splitTelegramChunks } from "@nakama/core/channel-message-format";
import type { AgentTodo } from "@nakama/core/contract";

export function stripMarkdownForTelegram(text: string): string {
  const protectedUrls = protectBareUrls(text.trim());
  let result = protectedUrls.text;

  result = result.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code: string) =>
    code.trim()
  );
  result = result.replace(/`([^`]+)`/g, "$1");
  result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
  result = result.replace(/\*([^*]+)\*/g, "$1");
  result = result.replace(/__([^_]+)__/g, "$1");
  result = result.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1");
  result = result.replace(/~~([^~\n]+)~~/g, "$1");
  result = result.replace(/\|\|([^|\n]+)\|\|/g, "$1");
  result = result.replace(/^#{1,6}\s+/gm, "");
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  return restoreBareUrls(result, protectedUrls.urls).trim();
}

export function prepareTelegramReply(text: string): string {
  return text.trim();
}

export function prepareTelegramFallbackReply(text: string): string {
  return stripMarkdownForTelegram(text);
}

/** Placeholder bare http(s) URLs so underscore italic stripping cannot mangle path tokens. */
function protectBareUrls(text: string) {
  const urls: string[] = [];

  // Stop at whitespace, markdown/HTML delimiters, and common trailing punctuation.
  const protectedText = text.replace(/https?:\/\/[^\s<>\]"'()]+/g, (url) => {
    const token = `@@TCURL${urls.length}@@`;
    urls.push(url);

    return token;
  });

  return { text: protectedText, urls } satisfies {
    text: string;
    urls: string[];
  };
}

function restoreBareUrls(text: string, urls: string[]): string {
  let result = text;

  for (let index = 0; index < urls.length; index++) {
    result = result.replace(`@@TCURL${index}@@`, () => urls[index]!);
  }

  return result;
}

export function splitIntoChatBubbles(text: string, maxChars = 400): string[] {
  const trimmed = prepareTelegramReply(text);

  if (!trimmed) {
    return [];
  }

  if (trimmed.length <= maxChars) {
    return splitTelegramChunks(trimmed);
  }

  const paragraphs = trimmed
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

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

  return merged.flatMap((bubble) => splitTelegramChunks(bubble));
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

export type TelegramTodoRunState =
  | "working"
  | "completed"
  | "stopped"
  | "failed";

export function renderTelegramTodoStatus(
  todos: AgentTodo[],
  state: TelegramTodoRunState
): string {
  const header =
    state === "completed"
      ? "✅ Completed"
      : state === "stopped"
        ? "⏹️ Stopped"
        : state === "failed"
          ? "❌ Failed"
          : "🛠️ Working";

  return [header, ...todos.map(formatTelegramTodoLine)].join("\n");
}

function formatTelegramTodoLine(todo: AgentTodo): string {
  switch (todo.status) {
    case "completed":
      return `✅ [x] ${todo.content}`;
    case "in_progress":
      return `🔄 [~] ${todo.content}`;
    case "cancelled":
      return `🚫 [-] ${todo.content}`;
    default:
      return `⏳ [ ] ${todo.content}`;
  }
}

export const HELP_TEXT = `Nakama Telegram commands:

/start — welcome and show this message
/help — show this message
/stop — stop the agent's current reply (works during tool runs)
/clear — clear chat history
/compact — compact conversation history
/new — start a new conversation
/org — choose or switch organization
/profile — choose or switch bot profile
/status — server and model status

Send text, a photo, or a supported document (pdf, docx, txt, csv — max 5 MB) to chat with the agent.`;
