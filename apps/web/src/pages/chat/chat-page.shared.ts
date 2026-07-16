import type { ChatListItem } from "@/lib/chat-history";

export function findRetryPrompt(
  messages: ChatListItem[],
  assistantMessage: ChatListItem,
): ChatListItem | null {
  if (typeof assistantMessage.historyIndex !== "number") {
    return null;
  }

  return (
    messages.findLast(
      (message) =>
        message.role === "user" &&
        typeof message.historyIndex === "number" &&
        message.historyIndex < assistantMessage.historyIndex!,
    ) ?? null
  );
}

export function findRetryCheckpoint(
  messages: ChatListItem[],
  promptMessage: ChatListItem,
): ChatListItem | null {
  if (typeof promptMessage.historyIndex !== "number") {
    return null;
  }

  return (
    messages.findLast(
      (message) =>
        typeof message.historyIndex === "number" &&
        message.historyIndex < promptMessage.historyIndex!,
    ) ?? null
  );
}
