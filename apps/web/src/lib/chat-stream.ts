import type { ChatStatus } from "ai";
import { nanoid } from "nanoid";
import type { Dispatch, SetStateAction } from "react";
import type {
  AgentQuestionAnswer,
  AgentQuestionnaire,
  AgentTodo,
} from "@nakama/core/contract";
import type { StreamHandlers } from "@nakama/client";
import type { ChatListItem } from "@/lib/chat-history";
import { upsertStreamingToolMessage } from "@/lib/chat-stream-artifact";
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

  if (isSubAgentTool(tool)) {
    return formatSubAgentToolResult(result);
  }

  return formatDefaultToolResult(result);
}

export function isToolResultError(result: unknown, formattedOutput: string | null): boolean {
  if (typeof result === "object" && result !== null) {
    const record = result as { error?: unknown; exitCode?: number | null; timedOut?: boolean };
    const error = record.error;

    if (typeof error === "string" && error.trim()) {
      return true;
    }

    if (record.timedOut || (record.exitCode != null && record.exitCode !== 0)) {
      return true;
    }
  }

  if (
    formattedOutput &&
    /^(unknown tool|error:|failed\b|\[stderr\]|\[exit code|\[timed out\])/i.test(formattedOutput)
  ) {
    return true;
  }

  return false;
}

export function isSubAgentTool(tool: string | undefined): boolean {
  return tool === "sub_agent";
}

export type SubAgentToolStatus = "success" | "fail" | "timeout";

export interface ParsedSubAgentResult {
  status: SubAgentToolStatus;
  summary: string;
  output: string;
  error?: string;
}

export function parseSubAgentResult(result: unknown): ParsedSubAgentResult | null {
  if (typeof result !== "object" || result === null) {
    return null;
  }

  const record = result as {
    status?: unknown;
    summary?: unknown;
    output?: unknown;
    error?: unknown;
  };

  const status =
    record.status === "success" || record.status === "fail" || record.status === "timeout"
      ? record.status
      : null;

  if (!status) {
    return null;
  }

  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const output = typeof record.output === "string" ? record.output.trim() : "";
  const error = typeof record.error === "string" && record.error.trim() ? record.error.trim() : undefined;

  return {
    status,
    summary,
    output,
    ...(error ? { error } : {}),
  };
}

export function formatSubAgentTitle(input?: Record<string, unknown>): string {
  const task = typeof input?.task === "string" ? input.task.trim() : "";

  if (!task) {
    return "Sub-agent";
  }

  return truncateDisplay(task.split("\n")[0] ?? task, 56);
}

export function formatSubAgentSubtitle(
  input: Record<string, unknown> | undefined,
  result: unknown,
  running: boolean,
): string {
  if (running) {
    const context = typeof input?.context === "string" ? input.context.trim() : "";

    if (context) {
      return truncateDisplay(context.split("\n")[0] ?? context, 72);
    }

    return "Working…";
  }

  const parsed = parseSubAgentResult(result);

  if (!parsed) {
    return "Sub-agent finished";
  }

  if (parsed.status === "timeout") {
    return parsed.error ?? "Timed out";
  }

  if (parsed.status === "fail") {
    return parsed.error ?? (parsed.summary || "Failed");
  }

  if (parsed.summary) {
    return truncateDisplay(parsed.summary.split("\n")[0] ?? parsed.summary, 96);
  }

  return "Completed";
}

export function formatSubAgentToolResult(result: unknown): string | null {
  const parsed = parseSubAgentResult(result);

  if (!parsed) {
    return formatDefaultToolResult(result);
  }

  if (parsed.output) {
    return parsed.output;
  }

  if (parsed.summary) {
    return parsed.summary;
  }

  if (parsed.error) {
    return parsed.error;
  }

  return null;
}

export function formatToolSummary(
  tool: string | undefined,
  input?: Record<string, unknown>,
): string | null {
  if (isSubAgentTool(tool) && typeof input?.task === "string" && input.task.trim()) {
    return input.task.trim();
  }

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

function truncateDisplay(value: string, maxLength: number): string {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

export function formatToolActionLabel(
  tool: string | undefined,
  input?: Record<string, unknown>,
): string {
  const summary = formatToolSummary(tool, input);

  if (isSubAgentTool(tool)) {
    return formatSubAgentTitle(input);
  }

  if (tool === "bash" && summary) {
    return `Ran ${truncateDisplay(summary.split("\n")[0] ?? summary, 96)}`;
  }

  if ((tool === "write_file" || tool === "write_docx") && typeof input?.path === "string") {
    return `Wrote ${basename(input.path)}`;
  }

  if (tool === "delete_file" && typeof input?.path === "string") {
    return `Deleted ${basename(input.path)}`;
  }

  if (tool === "edit_file" && typeof input?.path === "string") {
    return `Edited ${basename(input.path)}`;
  }

  if (tool === "read_file" && typeof input?.path === "string") {
    return `Read ${basename(input.path)}`;
  }

  if (tool === "search_files") {
    const query = typeof input?.query === "string" ? input.query.trim() : null;
    const path = typeof input?.path === "string" ? basename(input.path) : null;

    if (query && path) {
      return `Searched ${path} · ${truncateDisplay(query, 48)}`;
    }

    if (query) {
      return `Searched · ${truncateDisplay(query, 64)}`;
    }
  }

  if (summary) {
    const firstLine = summary.split("\n")[0] ?? summary;

    if (/^(npm|pnpm|yarn|bun|node|python|cd|curl|git|tail|cat|grep|ls)\b/.test(firstLine)) {
      return `Ran ${truncateDisplay(firstLine, 96)}`;
    }

    if (typeof input?.path === "string") {
      return `Read ${basename(input.path)} · ${truncateDisplay(firstLine, 48)}`;
    }

    const displayTool = tool?.replace(/^[^_]+__/, "") ?? "tool";
    return `${displayTool} · ${truncateDisplay(firstLine, 64)}`;
  }

  return tool?.replace(/^[^_]+__/, "") ?? "Tool";
}

export function formatToolCommand(
  tool: string | undefined,
  input?: Record<string, unknown>,
): string | null {
  if (tool === "bash" && typeof input?.command === "string" && input.command.trim()) {
    return input.command.trim();
  }

  if (!input || Object.keys(input).length === 0) {
    return null;
  }

  return JSON.stringify(input, null, 2);
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
          artifactStreaming: false,
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
  options: {
    onTodosUpdated?: (todos: AgentTodo[]) => void;
    onQuestionnaireUpdated?: (questionnaire: AgentQuestionnaire | null) => void;
  } = {},
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
    onToolInputDelta: (event) => {
      setMessages((current) =>
        upsertStreamingToolMessage(current, {
          toolCallId: event.toolCallId,
          tool: event.tool,
          accumulatedArguments: event.accumulatedArguments ?? event.delta,
        }),
      );
    },
    onToolStart: (event) => {
      setMessages((current) => {
        const next = current.map((message) =>
          message.role === "assistant" && message.streaming
            ? { ...message, streaming: false }
            : message,
        );

        const existingIndex = next.findIndex(
          (message) => message.toolCallId === event.toolCallId,
        );

        const toolMessage: ChatListItem = {
          id: event.toolCallId,
          role: "tool",
          createdAt: new Date().toISOString(),
          content: event.tool,
          toolCallId: event.toolCallId,
          tool: event.tool,
          toolStatus: "running",
          toolInput: event.input,
        };

        if (existingIndex >= 0) {
          const merged = [...next];
          merged[existingIndex] = {
            ...merged[existingIndex],
            ...toolMessage,
            artifactStreaming: merged[existingIndex]?.artifactStreaming,
            toolInputAccumulatedJson: merged[existingIndex]?.toolInputAccumulatedJson,
          };
          return merged;
        }

        return [...next, toolMessage];
      });
    },
    onToolEnd: (event) => {
      setMessages((current) =>
        current.map((message) =>
          message.toolCallId === event.toolCallId
            ? {
                ...message,
                toolStatus: "done",
                artifactStreaming: false,
                content: `${event.tool} completed`,
                toolResult: event.result,
              }
            : message,
        ),
      );
    },
    onTodosUpdated: options.onTodosUpdated,
    onQuestionnaireUpdated: options.onQuestionnaireUpdated,
  };
}

type OutgoingMessageOptions = {
  thinkingEnabled?: boolean;
  imageAttachments?: Array<{ url?: string; mediaType: string; description?: string | null }>;
  questionnaireAnswers?: AgentQuestionAnswer[];
};

function buildOutgoingUserMessage(
  text: string,
  images: Array<{ mediaType: string; url: string }> = [],
  documents: Array<{ filename: string; mediaType: string }> = [],
  options: OutgoingMessageOptions = {},
): ChatListItem {
  return {
    id: nanoid(),
    role: "user",
    content: text,
    images: images.length > 0 ? images : undefined,
    imageAttachments:
      options.imageAttachments && options.imageAttachments.length > 0
        ? options.imageAttachments
        : undefined,
    documents: documents.length > 0 ? documents : undefined,
    questionnaireAnswers:
      options.questionnaireAnswers && options.questionnaireAnswers.length > 0
        ? options.questionnaireAnswers
        : undefined,
  };
}

function buildStreamingAssistantMessage(thinkingEnabled = false): ChatListItem {
  return {
    id: nanoid(),
    role: "assistant",
    content: "",
    streaming: true,
    ...(thinkingEnabled ? { thinking: "", thinkingStreaming: true } : {}),
  };
}

export function appendOutgoingMessages(
  setMessages: Dispatch<SetStateAction<ChatListItem[]>>,
  text: string,
  images: Array<{ mediaType: string; url: string }> = [],
  documents: Array<{ filename: string; mediaType: string }> = [],
  options: OutgoingMessageOptions = {},
): void {
  setMessages((current) => [
    ...current,
    buildOutgoingUserMessage(text, images, documents, options),
    buildStreamingAssistantMessage(options.thinkingEnabled),
  ]);
}

export const composerIconButtonClass =
  "size-8 shrink-0 rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40";

export const composerToolbarClass = "flex min-w-0 flex-1 flex-wrap items-center gap-1.5";

const composerInputGroupBase =
  "[&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:flex-col [&_[data-slot=input-group]]:items-stretch [&_[data-slot=input-group]]:gap-0 [&_[data-slot=input-group]]:p-2.5 sm:[&_[data-slot=input-group]]:p-3";

const composerFocusRing =
  "focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-ring/25";

/** Chat composer InputGroup: always solid. Overrides InputGroup's dark:bg-input/30 and has-disabled:opacity-50. */
export const composerInputGroupClass = "chat-composer-input overflow-visible";

export const composerDockClass = cn(
  "flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-[box-shadow,border-color]",
  composerFocusRing,
);

export const composerShellClass = cn(
  composerInputGroupBase,
  "[&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:border [&_[data-slot=input-group]]:border-border [&_[data-slot=input-group]]:shadow-xs [&_[data-slot=input-group]]:transition-[box-shadow,border-color] [&_[data-slot=input-group]:focus-within]:border-primary/30 [&_[data-slot=input-group]:focus-within]:ring-2 [&_[data-slot=input-group]:focus-within]:ring-ring/25",
);

export const composerShellStackedClass = cn(
  composerInputGroupBase,
  "w-full [&_form]:w-full",
  "[&_[data-slot=input-group]]:w-full [&_[data-slot=input-group]]:rounded-none [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none",
);

export const composerShellCompactClass =
  "[&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:flex-col [&_[data-slot=input-group]]:items-stretch [&_[data-slot=input-group]]:gap-0 [&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:border-border [&_[data-slot=input-group]]:p-2.5 [&_[data-slot=input-group]]:shadow-xs [&_[data-slot=input-group]]:transition-[box-shadow,border-color] [&_[data-slot=input-group]:focus-within]:border-primary/30 [&_[data-slot=input-group]:focus-within]:ring-2 [&_[data-slot=input-group]:focus-within]:ring-ring/25";
