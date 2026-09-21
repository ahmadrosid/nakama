import type { ChatListItem } from "@/lib/chat-history";

export function toolGroupElapsedSeconds(
  tools: ChatListItem[],
  now: number,
  active = false
): number | null {
  if (tools.length === 0) {
    return null;
  }
  let startedAt = Number.POSITIVE_INFINITY;
  let completedAt = Number.NEGATIVE_INFINITY;
  for (const tool of tools) {
    const start = tool.toolStartedAt;
    const end = tool.toolStatus === "running" ? now : tool.toolCompletedAt;
    if (
      start === undefined ||
      end === undefined ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end < start
    ) {
      return null;
    }
    startedAt = Math.min(startedAt, start);
    completedAt = Math.max(completedAt, end);
  }
  return Math.max(
    1,
    Math.floor(((active ? now : completedAt) - startedAt) / 1000)
  );
}

export type AssistantTurnSegment =
  | {
      groupId?: string;
      active?: boolean;
      kind: "work";
      thinking?: ChatListItem;
      tools: ChatListItem[];
    }
  | { kind: "text"; message: ChatListItem; thinking?: ChatListItem };

export function segmentAssistantTurn(
  messages: ChatListItem[],
  streamActive = false
): AssistantTurnSegment[] {
  const segments: AssistantTurnSegment[] = [];
  for (const message of messages) {
    if (
      message.role === "tool" ||
      (message.role === "assistant" && hasThinkingContent(message))
    ) {
      const previous = segments.at(-1);
      const work: Extract<AssistantTurnSegment, { kind: "work" }> =
        previous?.kind === "work"
          ? previous
          : {
              groupId: message.id,
              kind: "work",
              tools: [],
            };
      if (work !== previous) {
        segments.push(work);
      }

      if (message.role === "tool") {
        work.tools.push(message);
        if (work.thinking) {
          work.thinking = { ...work.thinking, thinkingStreaming: false };
        }
      } else {
        const prior = work.thinking;
        work.thinking = prior
          ? {
              ...message,
              createdAt: prior.createdAt,
              id: prior.id,
              thinking: [prior.thinking, message.thinking]
                .filter(Boolean)
                .join("\n\n"),
              thinkingDurationMs:
                prior.thinkingDurationMs !== undefined &&
                message.thinkingDurationMs !== undefined
                  ? prior.thinkingDurationMs + message.thinkingDurationMs
                  : undefined,
            }
          : message;
      }
    }

    if (message.role === "assistant" && hasAssistantText(message)) {
      segments.push({ kind: "text", message });
    }
  }

  const latestWork = segments.findLast((segment) => segment.kind === "work");
  if (latestWork?.kind === "work") {
    latestWork.active = streamActive;
  }
  return segments;
}

function hasThinkingContent(message: ChatListItem): boolean {
  return Boolean(message.thinking?.trim() || message.thinkingStreaming);
}

function hasAssistantText(message: ChatListItem): boolean {
  // Empty streaming bubbles are handled by the awaiting-model placeholder, not as text.
  // Failed markers always render even when the error string is the only content.
  return Boolean(message.content.trim() || message.failed);
}
