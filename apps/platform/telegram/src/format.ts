import type { AgentTodo } from "@nakama/core/contract";
import { renderTelegramPlainText } from "@nakama/core/telegram-rich-text";

export function prepareTelegramReply(text: string): string {
  return text.trim();
}

export function prepareTelegramFallbackReply(text: string): string {
  return renderTelegramPlainText(text);
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
