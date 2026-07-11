import { formatClientError } from "@nakama/core/api-error";
import type { AgentTodo } from "@nakama/core/contract";

const DISCORD_MAX_MESSAGE_LENGTH = 2000;

type DiscordTodoRunState = "working" | "completed" | "stopped" | "failed";

export function formatError(error: unknown): string {
  return formatClientError(error);
}

export function prepareDiscordReply(text: string): string {
  return text.trim();
}

export function splitDiscordMessage(text: string, maxLen = DISCORD_MAX_MESSAGE_LENGTH): string[] {
  const trimmed = prepareDiscordReply(text);

  if (!trimmed) {
    return [];
  }

  if (trimmed.length <= maxLen) {
    return [trimmed];
  }

  const paragraphs = trimmed.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length <= maxLen) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (paragraph.length <= maxLen) {
      current = paragraph;
      continue;
    }

    for (const hardChunk of hardSplit(paragraph, maxLen)) {
      chunks.push(hardChunk);
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function hardSplit(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf("\n", maxLen);

    if (splitAt <= 0) {
      splitAt = remaining.lastIndexOf(" ", maxLen);
    }

    if (splitAt <= 0) {
      splitAt = maxLen;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

export function renderDiscordTodoStatus(
  todos: AgentTodo[],
  state: DiscordTodoRunState,
): string {
  const header =
    state === "completed"
      ? "✅ Completed"
      : state === "stopped"
        ? "⏹️ Stopped"
        : state === "failed"
          ? "❌ Failed"
          : "🛠️ Working";

  return [header, ...todos.map(formatDiscordTodoLine)].join("\n");
}

function formatDiscordTodoLine(todo: AgentTodo): string {
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

export const HELP_TEXT = `Nakama Discord commands:

/start — welcome and pairing help
/help — show this message
/stop — stop the agent's current reply
/clear — clear chat history
/compact — compact conversation history
/new — start a new conversation
/org — choose or switch organization (send as text)
/profile — choose or switch bot profile (send as text)
/status — server and model status

In servers, @mention the bot or reply to it to chat. Pair in a DM first.`;
