import type { ChatListItem, FailedChatTurn } from "@/lib/chat-history";
import { createClientId } from "@/lib/client-id";

export function findRetryPrompt(
  messages: ChatListItem[],
  assistantMessage: ChatListItem
): ChatListItem | null {
  if (typeof assistantMessage.historyIndex !== "number") {
    return null;
  }

  return (
    messages.findLast(
      (message) =>
        message.role === "user" &&
        typeof message.historyIndex === "number" &&
        message.historyIndex < assistantMessage.historyIndex!
    ) ?? null
  );
}

export function findRetryCheckpoint(
  messages: ChatListItem[],
  promptMessage: ChatListItem
): ChatListItem | null {
  if (typeof promptMessage.historyIndex !== "number") {
    return null;
  }

  return (
    messages.findLast(
      (message) =>
        typeof message.historyIndex === "number" &&
        message.historyIndex < promptMessage.historyIndex!
    ) ?? null
  );
}

function buildFailedAssistantMessage(error: string): ChatListItem {
  return {
    content: error,
    failed: true,
    id: createClientId(),
    role: "assistant",
  };
}

/** Convert a live streaming turn into a persistent failed marker. */
export function markStreamingTurnFailed(
  messages: ChatListItem[],
  error: string
): ChatListItem[] {
  const next = messages.map((message) => {
    if (message.role === "tool" && message.toolStatus === "running") {
      return {
        ...message,
        artifactStreaming: false,
        content: `${message.tool} stopped`,
        toolStatus: "done" as const,
      };
    }

    return message;
  });

  for (let index = next.length - 1; index >= 0; index -= 1) {
    const message = next[index];

    if (message?.role === "assistant" && message.streaming) {
      next[index] = {
        ...message,
        content: error,
        failed: true,
        streaming: false,
        thinkingStreaming: false,
      };
      return next;
    }
  }

  const last = next.at(-1);

  if (last?.role === "assistant" && last.failed) {
    next[next.length - 1] = { ...last, content: error, failed: true };
    return next;
  }

  if (last?.role === "user") {
    return [...next, buildFailedAssistantMessage(error)];
  }

  return next;
}

/** Re-attach a stored failed turn after reload (server history rolls failed sends back). */
export function appendFailedTurnIfNeeded(
  messages: ChatListItem[],
  failed: FailedChatTurn
): ChatListItem[] {
  if (messages.some((message) => message.failed)) {
    return messages;
  }

  const last = messages.at(-1);

  if (
    last?.role === "user" &&
    last.content === failed.text &&
    typeof last.historyIndex !== "number"
  ) {
    return [...messages, buildFailedAssistantMessage(failed.error)];
  }

  return [
    ...messages,
    {
      content: failed.text,
      id: createClientId(),
      role: "user",
    },
    buildFailedAssistantMessage(failed.error),
  ];
}

export function findFailedRetryPrompt(
  messages: ChatListItem[],
  failedMessage: ChatListItem
): ChatListItem | null {
  const failedIndex = messages.findIndex(
    (message) => message.id === failedMessage.id
  );

  if (failedIndex < 0) {
    return null;
  }

  for (let index = failedIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === "user") {
      return message;
    }
  }

  return null;
}

/** Drop the failed assistant + its optimistic user prompt before re-sending. */
export function messagesWithoutFailedTurn(
  messages: ChatListItem[],
  failedMessage: ChatListItem
): ChatListItem[] {
  const failedIndex = messages.findIndex(
    (message) => message.id === failedMessage.id
  );

  if (failedIndex < 0) {
    return messages;
  }

  let start = failedIndex;
  const previous = messages[failedIndex - 1];

  if (previous?.role === "user" && typeof previous.historyIndex !== "number") {
    start = failedIndex - 1;
  }

  return [...messages.slice(0, start), ...messages.slice(failedIndex + 1)];
}
