import { formatClientError } from "@tinyclaw/core/api-error";
import type { AgentTodo } from "@tinyclaw/core/contract";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

type TelegramTodoRunState = "working" | "completed" | "stopped" | "failed";

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
  return text.trim();
}

export function prepareTelegramFallbackReply(text: string): string {
  return stripMarkdownForTelegram(text);
}

export function renderTelegramRichText(text: string): string {
  const fencedBlocks: string[] = [];
  let result = text.trim().replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code: string) => {
    const token = `@@TCTOKEN${fencedBlocks.length}@@`;
    fencedBlocks.push(`<pre><code>${escapeTelegramHtml(code.trim())}</code></pre>`);
    return token;
  });

  result = escapeTelegramHtml(result);
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  result = result.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  result = result.replace(/__([^_]+)__/g, "<u>$1</u>");
  result = result.replace(/\*([^*]+)\*/g, "<i>$1</i>");
  result = result.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_, label: string, url: string) => `<a href="${escapeTelegramAttribute(url)}">${label}</a>`,
  );

  for (let index = 0; index < fencedBlocks.length; index++) {
    result = result.replace(`@@TCTOKEN${index}@@`, fencedBlocks[index]!);
  }

  return result.trim();
}

function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeTelegramAttribute(text: string): string {
  return text.replace(/"/g, "&quot;");
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

export function renderTelegramTodoStatus(
  todos: AgentTodo[],
  state: TelegramTodoRunState,
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

export const HELP_TEXT = `TinyClaw Telegram commands:

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
