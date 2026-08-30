import type { ImageAttachment, SendMessageInput } from "@nakama/core";
import { splitInputDisplayLines } from "./prompt-display";

export interface PendingMessage {
  echoed?: boolean;
  images?: ImageAttachment[];
  line: string;
  sendInput: SendMessageInput;
}

const PENDING_PREFIX = "⏳ pending: ";
const MAX_PENDING_DISPLAY_LINES = 6;

export function formatPendingSummary(message: PendingMessage): string {
  const text = message.line.trim() || (message.images?.length ? "[image]" : "");
  return text.replace(/\s+/g, " ");
}

export function formatPendingDisplayLines(
  messages: PendingMessage[],
  width: number,
  maxLines = MAX_PENDING_DISPLAY_LINES
): string[] {
  if (messages.length === 0) {
    return [];
  }

  const lines: string[] = [];
  const prefixLength = PENDING_PREFIX.length;

  for (
    let messageIndex = 0;
    messageIndex < messages.length;
    messageIndex += 1
  ) {
    const message = messages[messageIndex];
    const summary = formatPendingSummary(message);
    const wrapped = splitInputDisplayLines(summary, prefixLength, width);

    for (let index = 0; index < wrapped.length; index += 1) {
      const segment = wrapped[index] ?? "";
      lines.push(
        index === 0
          ? `${PENDING_PREFIX}${segment}`
          : `${" ".repeat(prefixLength)}${segment}`
      );

      if (lines.length >= maxLines) {
        const remaining = messages.length - messageIndex - 1;

        if (remaining > 0) {
          lines[maxLines - 1] = `${PENDING_PREFIX}… and ${remaining} more`;
        }

        return lines;
      }
    }
  }

  return lines;
}

/**
 * Serialize async work so each task runs after the prior one settles.
 * Prior rejection does not block the next task.
 */
export function createSerializedQueue(): {
  enqueue(task: () => Promise<void>): Promise<void>;
} {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue(task: () => Promise<void>): Promise<void> {
      const run = tail.then(task, task);
      tail = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
  };
}
