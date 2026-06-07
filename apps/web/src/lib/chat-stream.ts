import type { ChatStatus } from "ai";
import { nanoid } from "nanoid";
import type { Dispatch, SetStateAction } from "react";
import type { AgentTodo } from "@tinyclaw/core/contract";
import type { StreamHandlers } from "@tinyclaw/client";
import type { ChatListItem } from "@/lib/chat-history";
import { cn } from "@/lib/utils";

export function formatBashToolResult(result: unknown): string | null {
  if (typeof result !== "object" || result === null) {
    return null;
  }

  const { stdout, stderr, exitCode, timedOut } = result as {
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
    timedOut?: boolean;
  };

  const parts: string[] = [];

  if (stdout) {
    parts.push(stdout.replace(/\r\n/g, "\n").trimEnd());
  }

  if (stderr?.trim()) {
    parts.push(`[stderr]\n${stderr.replace(/\r\n/g, "\n").trimEnd()}`);
  }

  if (timedOut) {
    parts.push("[timed out]");
  }

  if (exitCode != null && exitCode !== 0) {
    parts.push(`[exit code ${exitCode}]`);
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

export function formatDefaultToolResult(result: unknown): string | null {
  if (result == null) {
    return null;
  }

  if (typeof result === "string") {
    const trimmed = result.replace(/\r\n/g, "\n").trim();
    return trimmed || null;
  }

  if (typeof result === "object") {
    const error = (result as { error?: unknown }).error;

    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }

    return JSON.stringify(result, null, 2);
  }

  return String(result);
}

export function formatToolResult(tool: string | undefined, result: unknown): string | null {
  if (tool === "bash") {
    return formatBashToolResult(result);
  }

  return formatDefaultToolResult(result);
}

export function formatToolSummary(
  tool: string | undefined,
  input?: Record<string, unknown>,
): string | null {
  if (tool === "bash" && typeof input?.command === "string" && input.command.trim()) {
    return input.command.trim();
  }

  if (typeof input?.query === "string" && input.query.trim()) {
    return input.query.trim();
  }

  if (typeof input?.path === "string" && input.path.trim()) {
    return input.path.trim();
  }

  if (typeof input?.name === "string" && input.name.trim()) {
    return input.name.trim();
  }

  if (input) {
    for (const value of Object.values(input)) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }

  return null;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function finalizeStreamingMessages(messages: ChatListItem[]): ChatListItem[] {
  const next = messages.map((message) =>
    message.role === "tool" && message.toolStatus === "running"
      ? {
          ...message,
          toolStatus: "done" as const,
          content: `${message.tool} stopped`,
        }
      : message,
  );

  for (let index = next.length - 1; index >= 0; index -= 1) {
    const message = next[index];

    if (message?.role === "assistant") {
      next[index] = {
        ...message,
        streaming: false,
        thinkingStreaming: false,
      };
      break;
    }
  }

  return next;
}

export function deriveChatStatus(
  busy: boolean,
  error: string | null,
  messages: ChatListItem[],
): ChatStatus {
  if (error) {
    return "error";
  }

  const last = messages[messages.length - 1];

  if (last?.role === "assistant" && last.streaming) {
    return "streaming";
  }

  if (busy) {
    return "submitted";
  }

  return "ready";
}

export function buildStreamHandlers(
  setMessages: Dispatch<SetStateAction<ChatListItem[]>>,
  options: { onTodosUpdated?: (todos: AgentTodo[]) => void } = {},
): StreamHandlers {
  return {
    onThinking: (delta) => {
      setMessages((current) => {
        const next = [...current];
        const last = next[next.length - 1];

        if (last?.role === "assistant" && last.streaming) {
          next[next.length - 1] = {
            ...last,
            thinking: `${last.thinking ?? ""}${delta}`,
            thinkingStreaming: true,
          };
          return next;
        }

        return next;
      });
    },
    onChunk: (delta) => {
      setMessages((current) => {
        const next = [...current];
        const last = next[next.length - 1];

        if (last?.role === "assistant" && last.streaming) {
          next[next.length - 1] = {
            ...last,
            content: last.content + delta,
            streaming: true,
            ...(last.thinkingStreaming ? { thinkingStreaming: false } : {}),
          };
          return next;
        }

        next.push({
          id: nanoid(),
          role: "assistant",
          content: delta,
          streaming: true,
        });
        return next;
      });
    },
    onToolStart: (event) => {
      setMessages((current) => {
        const next = current.map((message) =>
          message.role === "assistant" && message.streaming
            ? { ...message, streaming: false }
            : message,
        );

        return [
          ...next,
          {
            id: event.toolCallId,
            role: "tool",
            content: event.tool,
            toolCallId: event.toolCallId,
            tool: event.tool,
            toolStatus: "running",
            toolInput: event.input,
          },
        ];
      });
    },
    onToolEnd: (event) => {
      setMessages((current) =>
        current.map((message) =>
          message.toolCallId === event.toolCallId
            ? {
                ...message,
                toolStatus: "done",
                content: `${event.tool} completed`,
                toolResult: event.result,
              }
            : message,
        ),
      );
    },
    onTodosUpdated: options.onTodosUpdated,
  };
}

export function appendOutgoingMessages(
  setMessages: Dispatch<SetStateAction<ChatListItem[]>>,
  text: string,
  images: Array<{ mediaType: string; url: string }> = [],
  documents: Array<{ filename: string; mediaType: string }> = [],
  options: { thinkingEnabled?: boolean } = {},
): void {
  setMessages((current) => [
    ...current,
    {
      id: nanoid(),
      role: "user",
      content: text,
      images: images.length > 0 ? images : undefined,
      documents: documents.length > 0 ? documents : undefined,
    },
    {
      id: nanoid(),
      role: "assistant",
      content: "",
      streaming: true,
      ...(options.thinkingEnabled ? { thinking: "", thinkingStreaming: true } : {}),
    },
  ]);
}

export const composerIconButtonClass =
  "size-8 shrink-0 rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40";

export const composerToolbarClass = "flex min-w-0 flex-1 flex-wrap items-center gap-1.5";

const composerInputGroupBase =
  "[&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:flex-col [&_[data-slot=input-group]]:items-stretch [&_[data-slot=input-group]]:gap-0 [&_[data-slot=input-group]]:p-2.5 sm:[&_[data-slot=input-group]]:p-3";

const composerFocusRing =
  "focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-ring/25";

export const composerDockClass = cn(
  "flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-[box-shadow,border-color]",
  composerFocusRing,
);

export const composerShellClass = cn(
  composerInputGroupBase,
  "[&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:border [&_[data-slot=input-group]]:border-border [&_[data-slot=input-group]]:bg-card [&_[data-slot=input-group]]:shadow-sm [&_[data-slot=input-group]]:transition-[box-shadow,border-color] [&_[data-slot=input-group]:focus-within]:border-primary/30 [&_[data-slot=input-group]:focus-within]:ring-2 [&_[data-slot=input-group]:focus-within]:ring-ring/25",
);

export const composerShellStackedClass = cn(
  composerInputGroupBase,
  "w-full [&_form]:w-full",
  "[&_[data-slot=input-group]]:w-full [&_[data-slot=input-group]]:rounded-none [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none",
);

export const composerShellCompactClass =
  "[&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:flex-col [&_[data-slot=input-group]]:items-stretch [&_[data-slot=input-group]]:gap-0 [&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:border-border [&_[data-slot=input-group]]:bg-card [&_[data-slot=input-group]]:p-2.5 [&_[data-slot=input-group]]:shadow-sm [&_[data-slot=input-group]]:transition-[box-shadow,border-color] [&_[data-slot=input-group]:focus-within]:border-primary/30 [&_[data-slot=input-group]:focus-within]:ring-2 [&_[data-slot=input-group]:focus-within]:ring-ring/25";
