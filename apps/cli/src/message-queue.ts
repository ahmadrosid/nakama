import type { ImageAttachment, SendMessageInput } from "@tinyclaw/core";
import { splitInputDisplayLines } from "./prompt-display";

export interface PendingMessage {
  line: string;
  images?: ImageAttachment[];
  sendInput: SendMessageInput;
  echoed?: boolean;
}

const PENDING_PREFIX = "⏳ pending: ";
const MAX_PENDING_DISPLAY_LINES = 6;

export class MessageQueue {
  private queue: PendingMessage[] = [];

  enqueue(message: PendingMessage): void {
    this.queue.push(message);
  }

  dequeue(): PendingMessage | undefined {
    return this.queue.shift();
  }

  peekAll(): PendingMessage[] {
    return [...this.queue];
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  clear(): void {
    this.queue = [];
  }
}

export function formatPendingSummary(message: PendingMessage): string {
  const text = message.line.trim() || (message.images?.length ? "[image]" : "");
  return text.replace(/\s+/g, " ");
}

export function formatPendingDisplayLines(
  messages: PendingMessage[],
  width: number,
  maxLines = MAX_PENDING_DISPLAY_LINES,
): string[] {
  if (messages.length === 0) {
    return [];
  }

  const lines: string[] = [];
  const prefixLength = PENDING_PREFIX.length;

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    const summary = formatPendingSummary(message);
    const wrapped = splitInputDisplayLines(summary, prefixLength, width);

    for (let index = 0; index < wrapped.length; index += 1) {
      const segment = wrapped[index] ?? "";
      lines.push(
        index === 0
          ? `\x1b[2m${PENDING_PREFIX}${segment}\x1b[0m`
          : `\x1b[2m${" ".repeat(prefixLength)}${segment}\x1b[0m`,
      );

      if (lines.length >= maxLines) {
        const remaining = messages.length - messageIndex - 1;

        if (remaining > 0) {
          lines[maxLines - 1] = `\x1b[2m${PENDING_PREFIX}… and ${remaining} more\x1b[0m`;
        }

        return lines;
      }
    }
  }

  return lines;
}
