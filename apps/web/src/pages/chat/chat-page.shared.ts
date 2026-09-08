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

function findRetryCheckpoint(
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

/** Where to branch a session when resending a prompt, and what the branch keeps. */
export interface PromptBranchPlan {
  /** Messages already in history that the branch starts with. */
  initialMessages: ChatListItem[];
  /** History index the branch is cut at. */
  messageIndex: number;
}

/**
 * Plan for resending `prompt`: branch at the row before it and carry everything
 * up to that row. Null when nothing precedes the prompt in history, which means
 * a fresh session rather than a branch.
 */
export function planPromptBranch(
  messages: ChatListItem[],
  prompt: ChatListItem
): PromptBranchPlan | null {
  const checkpoint = findRetryCheckpoint(messages, prompt);
  const messageIndex = checkpoint?.historyIndex;

  if (typeof messageIndex !== "number") {
    return null;
  }

  return {
    initialMessages: messages.filter(
      (item) =>
        typeof item.historyIndex === "number" &&
        item.historyIndex <= messageIndex
    ),
    messageIndex,
  };
}

/**
 * The text an edit should resend, or null when the edit changes nothing and the
 * flow should stop before branching.
 */
export function editedPromptText(
  message: ChatListItem,
  text: string
): string | null {
  const next = text.trim();

  if (!next || next === message.content.trim()) {
    return null;
  }

  return next;
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

  return (
    messages
      .slice(0, failedIndex)
      .findLast((message) => message.role === "user") ?? null
  );
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

/**
 * Wall-clock stamp for post-turn polling, bumped by 1ms when two turns finish
 * in the same millisecond so consumers never see a duplicate key.
 */
export function nextSuccessfulTurnAt(
  previous: number | null,
  now = Date.now()
): number {
  return previous != null && now <= previous ? previous + 1 : now;
}
