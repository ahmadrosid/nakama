import type { ChatListItem } from "@/lib/chat-history";

export type AssistantTurnSegment =
  | { kind: "work"; thinking?: ChatListItem; tools: ChatListItem[] }
  | { kind: "text"; message: ChatListItem; thinking?: ChatListItem };

export function segmentAssistantTurn(messages: ChatListItem[]): AssistantTurnSegment[] {
  const segments: AssistantTurnSegment[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;

    if (message.role === "tool") {
      const thinking = findThinkingForToolRun(messages, index);
      const tools: ChatListItem[] = [];

      while (index < messages.length && messages[index]?.role === "tool") {
        tools.push(messages[index]!);
        index += 1;
      }

      segments.push({ kind: "work", thinking, tools });
      index -= 1;
      continue;
    }

    if (message.role === "assistant") {
      const hasThinking = hasThinkingContent(message);
      const hasText = hasAssistantText(message);
      const nextIsTool = messages[index + 1]?.role === "tool";

      if (hasThinking && nextIsTool) {
        continue;
      }

      if (hasThinking && !hasText) {
        segments.push({ kind: "work", thinking: message, tools: [] });
        continue;
      }

      if (hasText) {
        segments.push({ kind: "text", message, ...(hasThinking ? { thinking: message } : {}) });
      }
    }
  }

  return segments;
}

function findThinkingForToolRun(
  messages: ChatListItem[],
  toolIndex: number,
): ChatListItem | undefined {
  for (let index = toolIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (!message || message.role === "tool") {
      continue;
    }

    if (message.role === "user") {
      break;
    }

    if (hasThinkingContent(message)) {
      return message;
    }

    if (hasAssistantText(message)) {
      break;
    }
  }

  return undefined;
}

function hasThinkingContent(message: ChatListItem): boolean {
  return Boolean(message.thinking?.trim() || message.thinkingStreaming);
}

function hasAssistantText(message: ChatListItem): boolean {
  return Boolean(message.content.trim() || (message.streaming && !message.thinkingStreaming));
}
