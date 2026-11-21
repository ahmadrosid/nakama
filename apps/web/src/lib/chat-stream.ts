import type { StreamHandlers } from "@nakama/client";
import type {
  AgentQuestionAnswer,
  AgentQuestionnaire,
  AgentTodo,
  ChatContextUsage,
  ProfileSummary,
} from "@nakama/core/contract";
import { cn } from "@nakama/ui/utils";
import type { Dispatch, SetStateAction } from "react";
import type { ChatStatus } from "@/lib/ai-ui-types";
import type { ChatListItem } from "@/lib/chat-history";
import { upsertStreamingToolMessage } from "@/lib/chat-stream-artifact";
import {
  formatListWorkflowsToolResult,
  isListWorkflowsTool,
} from "@/lib/chat-stream-workflow";
import { addChatUsage } from "@/lib/chat-usage";
import { createClientId } from "@/lib/client-id";
import {
  readBoolean,
  readRawString,
  readRecord,
  readString,
} from "@/lib/json-readers";
import type { DisplayDocument } from "@/lib/pasted-text";

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts untrusted provider or tool output and decodes it at this boundary.
function formatBashToolResult(result: unknown): string | null {
  const record = readRecord(result);

  if (!record) {
    return null;
  }

  const stdout = readRawString(record.stdout);
  const stderr = readRawString(record.stderr);
  const parts: string[] = [];

  if (stdout) {
    parts.push(stdout.replace(/\r\n/g, "\n").trimEnd());
  }

  if (stderr?.trim()) {
    parts.push(`[stderr]\n${stderr.replace(/\r\n/g, "\n").trimEnd()}`);
  }

  if (record.timedOut) {
    parts.push("[timed out]");
  }

  if (record.exitCode != null && record.exitCode !== 0) {
    parts.push(`[exit code ${record.exitCode}]`);
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts untrusted provider or tool output and decodes it at this boundary.
function formatDefaultToolResult(result: unknown): string | null {
  if (result == null) {
    return null;
  }

  const text = readRawString(result);

  if (text !== null) {
    const trimmed = text.replace(/\r\n/g, "\n").trim();

    return trimmed || null;
  }

  const record = readRecord(result);

  if (record) {
    const error = readString(record.error);

    return error ?? JSON.stringify(result, null, 2);
  }

  if (Array.isArray(result)) {
    return JSON.stringify(result, null, 2);
  }

  return String(result);
}

interface ToolResultImage {
  data: string;
  mimeType: string;
}

interface ToolResultImageSplit {
  images: ToolResultImage[];
  rest: unknown;
}

/** Pull MCP-style `{ type: "image" }` content out of a tool result; `rest` keeps the text parts. */
export function splitToolResultImages(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts untrusted provider or tool output and decodes it at this boundary.
  result: unknown
): ToolResultImageSplit {
  const record = readRecord(result);

  if (!record) {
    return { images: [], rest: result };
  }

  const { content } = record;

  if (!Array.isArray(content)) {
    return { images: [], rest: result };
  }

  const images: ToolResultImage[] = [];
  const texts: string[] = [];
  // The server now sends image bytes apart and leaves a `{ type: "image" }` stub.
  let hasImagePart = false;

  for (const item of content) {
    const part = readRecord(item);

    if (!part) {
      continue;
    }

    const type = part.type;
    const data = readRawString(part.data);
    const mimeType = readRawString(part.mimeType);
    const text = readString(part.text);

    if (type === "image") {
      hasImagePart = true;
    }

    if (
      type === "image" &&
      data !== null &&
      mimeType !== null &&
      /^image\/[\w.+-]+$/.test(mimeType)
    ) {
      images.push({ data, mimeType });
    } else if (type === "text" && text !== null) {
      texts.push(text);
    }
  }

  if (!hasImagePart) {
    return { images, rest: result };
  }

  return { images, rest: texts.length > 0 ? texts.join("\n\n") : null };
}

export function formatToolResult(
  tool: string | undefined,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts untrusted provider or tool output and decodes it at this boundary.
  result: unknown
): string | null {
  if (tool === "read_file") {
    const record = readRecord(result);

    if (record && !("error" in record)) {
      const content = readRawString(record.content);

      if (content !== null) {
        return content.replace(/\r\n/g, "\n").trim() || null;
      }
    }
  }

  if (tool === "extract_document_text") {
    const record = readRecord(result);

    if (record && !("error" in record)) {
      const raw = readRawString(record.text);

      if (raw !== null) {
        // The text starts with a one-paragraph note for the model; show the file.
        const text = raw.replace(/\r\n/g, "\n");
        const start = text.indexOf("\n\n");

        return (start === -1 ? text : text.slice(start + 2)).trim() || null;
      }
    }
  }

  if (tool === "bash") {
    return formatBashToolResult(result);
  }

  if (isSubAgentTool(tool)) {
    return formatSubAgentToolResult(result);
  }

  if (isListWorkflowsTool(tool)) {
    return formatListWorkflowsToolResult(result);
  }

  return formatDefaultToolResult(result);
}

export function isToolResultError(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts untrusted provider or tool output and decodes it at this boundary.
  result: unknown,
  formattedOutput: string | null
): boolean {
  const record = readRecord(result);

  if (record) {
    const error = readString(record.error);

    if (error) {
      return true;
    }

    if (record.timedOut || (record.exitCode != null && record.exitCode !== 0)) {
      return true;
    }
  }

  if (
    formattedOutput &&
    /^(unknown tool|error:|failed\b|\[stderr\]|\[exit code|\[timed out\])/i.test(
      formattedOutput
    )
  ) {
    return true;
  }

  return false;
}

export function isSubAgentTool(tool: string | undefined): boolean {
  return tool === "sub_agent";
}

type CreatedProfileSummary = Pick<
  ProfileSummary,
  "hasAvatar" | "id" | "isSuper" | "name" | "updatedAt"
> &
  Partial<Pick<ProfileSummary, "createdAt">>;

export function parseProfileCreatedResult(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts untrusted provider or tool output and decodes it at this boundary.
  result: unknown
): CreatedProfileSummary | null {
  const record = readRecord(result);

  if (!record) {
    return null;
  }

  // Accept the unmarked shape so older create_profile messages still get the
  // richer card after reload. New results always include the discriminator.
  if (record.type !== undefined && record.type !== "profile_created") {
    return null;
  }

  const profileRecord = readRecord(record.profile);

  if (!profileRecord) {
    return null;
  }

  // SAFETY: The checks below require every field the card reads; keep the
  // original record so extra fields like createdAt survive for Moodstone.
  const profile = profileRecord as Partial<CreatedProfileSummary>;

  const id = readRawString(profile.id);
  const name = readRawString(profile.name);
  const hasAvatar = readBoolean(profile.hasAvatar);
  const isSuper = readBoolean(profile.isSuper);
  const updatedAt = readRawString(profile.updatedAt);

  if (
    id === null ||
    name === null ||
    hasAvatar === null ||
    isSuper === null ||
    updatedAt === null
  ) {
    return null;
  }

  // SAFETY: The checks above reject a profile unless every required field is
  // present, so the same object now satisfies the full summary.
  return profile as CreatedProfileSummary;
}

export function parseGroupCreatedResult(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts untrusted provider or tool output and decodes it at this boundary.
  result: unknown
): { id: string; name: string } | null {
  const record = readRecord(result);
  const group = record ? readRecord(record.group) : null;

  if (!record || record.type !== "group_created" || !group) {
    return null;
  }

  const id = readRawString(group.id);
  const name = readRawString(group.name);

  return id !== null && name !== null ? { id, name } : null;
}

type SubAgentToolStatus = "success" | "fail" | "timeout";

export interface ParsedSubAgentResult {
  error?: string;
  output: string;
  /** The child chat the run went to, so the parent can link to it. */
  sessionId?: string;
  status: SubAgentToolStatus;
  summary: string;
}

export function parseSubAgentResult(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts untrusted provider or tool output and decodes it at this boundary.
  result: unknown
): ParsedSubAgentResult | null {
  const record = readRecord(result);

  if (!record) {
    return null;
  }

  const status =
    record.status === "success" ||
    record.status === "fail" ||
    record.status === "timeout"
      ? record.status
      : null;

  if (!status) {
    return null;
  }

  const summary = readString(record.summary) ?? "";
  const output = readString(record.output) ?? "";
  const error = readString(record.error) ?? undefined;
  const sessionId = readString(record.sessionId) ?? undefined;

  return {
    output,
    status,
    summary,
    // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
    ...(error ? { error } : {}),
    // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
    ...(sessionId ? { sessionId } : {}),
  };
}

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
export function formatSubAgentTitle(input?: Record<string, unknown>): string {
  const task = readString(input?.task) ?? "";

  if (!task) {
    return "Sub-agent";
  }

  return truncateDisplay(task.split("\n")[0] ?? task, 56);
}

export function formatSubAgentSubtitle(
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
  input: Record<string, unknown> | undefined,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts untrusted provider or tool output and decodes it at this boundary.
  result: unknown,
  running: boolean,
  activity?: string
): string {
  if (running) {
    if (activity?.trim()) {
      return truncateDisplay(
        activity.trim().split("\n")[0] ?? activity.trim(),
        72
      );
    }

    const context = readString(input?.context) ?? "";

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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts untrusted provider or tool output and decodes it at this boundary.
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

function formatToolSummary(
  tool: string | undefined,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
  input?: Record<string, unknown>
): string | null {
  const task = readString(input?.task);
  const command = readString(input?.command);
  const query = readString(input?.query);
  const path = readString(input?.path);
  const name = readString(input?.name);

  if (isSubAgentTool(tool) && task) {
    return task;
  }

  if (tool === "bash" && command) {
    return command;
  }

  if (query) {
    return query;
  }

  if (path) {
    return path;
  }

  if (name) {
    return name;
  }

  if (input) {
    for (const value of Object.values(input)) {
      const text = readString(value);

      if (text) {
        return text;
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
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
  input?: Record<string, unknown>,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Tool results are untrusted JSON and are narrowed below.
  result?: unknown
): string {
  const summary = formatToolSummary(tool, input);

  if (isSubAgentTool(tool)) {
    return formatSubAgentTitle(input);
  }

  const path = readRawString(input?.path);

  // The input holds only an attachment id; the result names the file.
  if (tool === "extract_document_text") {
    const filename = readString(readRecord(result)?.filename) ?? "";

    return filename ? `Read ${basename(filename)}` : "Read document";
  }

  if (isListWorkflowsTool(tool)) {
    return "Listed workflows";
  }

  if (tool === "bash") {
    const command = summary?.split("\n")[0];

    return command ? `Ran ${truncateDisplay(command, 96)}` : "Ran command";
  }

  if (
    (tool === "write_file" ||
      tool === "write_docx" ||
      tool === "save_artifact") &&
    path !== null
  ) {
    return `Wrote ${basename(path)}`;
  }

  if (tool === "delete_file" && path !== null) {
    return `Deleted ${basename(path)}`;
  }

  if (tool === "edit_file" && path !== null) {
    return `Edited ${basename(path)}`;
  }

  if (tool === "read_file" && path !== null) {
    return `Read ${basename(path)}`;
  }

  if (tool === "search_files") {
    const searchPath = path === null ? null : basename(path);

    return searchPath ? `Searched ${searchPath}` : "Searched files";
  }

  if (tool === "knowledge_base_search") {
    return "Searched knowledge base";
  }

  if (tool === "org_memory_search") {
    return "Searched organization memory";
  }

  if (summary) {
    const firstLine = summary.split("\n")[0] ?? summary;

    if (
      /^(npm|pnpm|yarn|bun|node|python|cd|curl|git|tail|cat|grep|ls)\b/.test(
        firstLine
      )
    ) {
      return `Ran ${truncateDisplay(firstLine, 96)}`;
    }

    if (path !== null) {
      return `Read ${basename(path)} · ${truncateDisplay(firstLine, 48)}`;
    }

    const displayTool = tool?.replace(/^[^_]+__/, "") ?? "tool";

    return `${displayTool} · ${truncateDisplay(firstLine, 64)}`;
  }

  return tool?.replace(/^[^_]+__/, "") ?? "Tool";
}

export function formatToolCommand(
  tool: string | undefined,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
  input?: Record<string, unknown>
): string | null {
  const command = readString(input?.command);

  if (tool === "bash" && command) {
    return command;
  }

  if (!input || Object.keys(input).length === 0) {
    return null;
  }

  return JSON.stringify(input, null, 2);
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Error causes may come from browser or network code and are narrowed by this handler.
export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function finalizeStreamingMessages(
  messages: ChatListItem[]
): ChatListItem[] {
  return messages.map((message) => {
    if (message.role === "tool" && message.toolStatus === "running") {
      return {
        ...message,
        artifactStreaming: false,
        content: `${message.tool} stopped`,
        toolCompletedAt: Date.now(),
        toolStatus: "done" as const,
      };
    }

    if (
      message.role === "assistant" &&
      (message.streaming || message.thinkingStreaming)
    ) {
      return {
        ...message,
        streaming: false,
        thinkingStreaming: false,
      };
    }

    return message;
  });
}

export function deriveChatStatus(
  busy: boolean,
  error: string | null,
  messages: ChatListItem[]
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

/** Messages after the latest user message (current assistant turn). */
function latestAssistantTurnMessages(messages: ChatListItem[]): ChatListItem[] {
  return messages.slice(
    messages.findLastIndex((message) => message?.role === "user") + 1
  );
}

/**
 * True when the SSE turn is still in flight but the transcript has no live
 * activity (no thinking stream, no running tool, no text tokens yet). Covers
 * first-token wait and the gap after tools before the next model turn.
 */
export function isAwaitingModelResponse(messages: ChatListItem[]): boolean {
  const turn = latestAssistantTurnMessages(messages);

  if (turn.length === 0) {
    return false;
  }

  if (
    turn.some(
      (message) => message.role === "tool" && message.toolStatus === "running"
    )
  ) {
    return false;
  }

  if (
    turn.some(
      (message) => message.role === "assistant" && message.thinkingStreaming
    )
  ) {
    return false;
  }

  if (
    turn.some(
      (message) =>
        message.role === "assistant" &&
        message.streaming &&
        message.content.trim().length > 0
    )
  ) {
    return false;
  }

  if (
    turn.some(
      (message) =>
        message.role === "assistant" &&
        message.streaming &&
        message.content.trim().length === 0
    )
  ) {
    return true;
  }

  return turn.some(
    (message) => message.role === "tool" || message.role === "assistant"
  );
}

export function awaitingModelLabel(
  messages: ChatListItem[]
): "Thinking…" | "Working…" {
  const turn = latestAssistantTurnMessages(messages);
  const hasTools = turn.some((message) => message.role === "tool");

  const hasThinkingText = turn.some(
    (message) =>
      message.role === "assistant" && Boolean(message.thinking?.trim())
  );

  return hasTools || hasThinkingText ? "Working…" : "Thinking…";
}

export function buildStreamHandlers(
  setMessages: Dispatch<SetStateAction<ChatListItem[]>>,
  options: {
    onTodosUpdated?: (todos: AgentTodo[]) => void;
    onQuestionnaireUpdated?: (questionnaire: AgentQuestionnaire | null) => void;
    onContextUsage?: (usage: ChatContextUsage) => void;
    /** Gets the reply the server sends with its done event. */
    onDone?: (reply: string) => void;
  } = {}
): StreamHandlers {
  return {
    onChunk: (delta) => {
      setMessages((current) => {
        const next = [...current];
        const last = next[next.length - 1];

        if (last?.role === "assistant" && last.streaming) {
          next[next.length - 1] = {
            ...last,
            content: last.content + delta,
            streaming: true,
            // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
            ...(last.thinkingStreaming ? { thinkingStreaming: false } : {}),
          };

          return next;
        }

        next.push({
          content: delta,
          id: createClientId(),
          role: "assistant",
          streaming: true,
        });

        return next;
      });
    },
    onContextUsage: options.onContextUsage,
    onDone: options.onDone,
    onQuestionnaireUpdated: options.onQuestionnaireUpdated,
    onSubAgentActivity: (event) => {
      setMessages((current) =>
        current.map((message) =>
          message.toolCallId === event.parentToolCallId &&
          message.toolStatus === "running"
            ? {
                ...message,
                subAgentActivity: event.label,
              }
            : message
        )
      );
    },
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

        // After tools the prior assistant is finalized; seed a new streaming
        // message so post-tool thinking is not dropped.
        next.push({
          content: "",
          id: createClientId(),
          role: "assistant",
          streaming: true,
          thinking: delta,
          thinkingStreaming: true,
        });

        return next;
      });
    },
    onTodosUpdated: options.onTodosUpdated,
    onToolEnd: (event) => {
      setMessages((current) =>
        current.map((message) =>
          message.toolCallId === event.toolCallId
            ? {
                ...message,
                artifactStreaming: false,
                content: `${event.tool} completed`,
                subAgentActivity: undefined,
                toolCompletedAt: Date.now(),
                toolGroupId: event.toolGroupId ?? message.toolGroupId,
                toolImages: event.images?.map((image) => ({
                  mediaType: image.mediaType,
                  url: `data:${image.mediaType};base64,${image.data}`,
                })),
                toolResult: event.result,
                toolStatus: "done",
              }
            : message
        )
      );
    },
    onToolInputDelta: (event) => {
      setMessages((current) =>
        upsertStreamingToolMessage(current, {
          accumulatedArguments: event.accumulatedArguments ?? event.delta,
          tool: event.tool,
          toolCallId: event.toolCallId,
          toolGroupId: event.toolGroupId,
        })
      );
    },
    onToolStart: (event) => {
      setMessages((current) => {
        const next = current.map((message) =>
          message.role === "assistant" && message.streaming
            ? { ...message, streaming: false }
            : message
        );

        const existingIndex = next.findIndex(
          (message) => message.toolCallId === event.toolCallId
        );

        const toolMessage: ChatListItem = {
          content: event.tool,
          createdAt: new Date().toISOString(),
          id: event.toolCallId,
          role: "tool",
          tool: event.tool,
          toolCallId: event.toolCallId,
          toolGroupId: event.toolGroupId,
          toolInput: event.input,
          toolStartedAt: Date.now(),
          toolStatus: "running",
        };

        if (existingIndex >= 0) {
          const merged = [...next];
          merged[existingIndex] = {
            ...merged[existingIndex],
            ...toolMessage,
            artifactStreaming: merged[existingIndex]?.artifactStreaming,
            toolInputAccumulatedJson:
              merged[existingIndex]?.toolInputAccumulatedJson,
          };

          return merged;
        }

        return [...next, toolMessage];
      });
    },
    onUsage: (usage) => {
      setMessages((current) => {
        // Attach to the latest assistant message of the current turn; a
        // tool-call-only step has no text bubble, so its usage lands on the
        // shell that precedes it and the turn footer sums them all.
        for (let index = current.length - 1; index >= 0; index -= 1) {
          const message = current[index];

          if (message?.role === "user") {
            break;
          }

          if (message?.role === "assistant") {
            const next = [...current];
            next[index] = {
              ...message,
              usage: addChatUsage(message.usage, usage),
            };

            return next;
          }
        }

        return current;
      });
    },
  };
}

type OutgoingMessageOptions = {
  thinkingEnabled?: boolean;
  imageAttachments?: Array<{
    url?: string;
    mediaType: string;
    description?: string | null;
  }>;
  questionnaireAnswers?: AgentQuestionAnswer[];
};

function buildOutgoingUserMessage(
  text: string,
  images: Array<{ mediaType: string; url: string }> = [],
  documents: DisplayDocument[] = [],
  options: OutgoingMessageOptions = {}
): ChatListItem {
  return {
    content: text,
    documents: documents.length > 0 ? documents : undefined,
    id: createClientId(),
    imageAttachments:
      options.imageAttachments && options.imageAttachments.length > 0
        ? options.imageAttachments
        : undefined,
    images: images.length > 0 ? images : undefined,
    questionnaireAnswers:
      options.questionnaireAnswers && options.questionnaireAnswers.length > 0
        ? options.questionnaireAnswers
        : undefined,
    role: "user",
  };
}

function buildStreamingAssistantMessage(thinkingEnabled = false): ChatListItem {
  return {
    content: "",
    id: createClientId(),
    role: "assistant",
    streaming: true,
    // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
    ...(thinkingEnabled ? { thinking: "", thinkingStreaming: true } : {}),
  };
}

export function appendOutgoingMessages(
  setMessages: Dispatch<SetStateAction<ChatListItem[]>>,
  text: string,
  images: Array<{ mediaType: string; url: string }> = [],
  documents: DisplayDocument[] = [],
  options: OutgoingMessageOptions = {}
): void {
  setMessages((current) => [
    ...current,
    buildOutgoingUserMessage(text, images, documents, options),
    buildStreamingAssistantMessage(options.thinkingEnabled),
  ]);
}

/** Visible 28px face; ≥40px hit via pseudo. */
export const composerHitTargetClass =
  "relative after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2";

/** Composer icon control: visible 28px face, ≥40px hit via pseudo. */
export const composerIconButtonClass = cn(
  composerHitTargetClass,
  "size-7 shrink-0 rounded-full bg-muted text-muted-foreground transition-[color,background-color,transform,opacity] hover:bg-muted/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
);

export const composerToolbarClass =
  "flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden @[22rem]/composer:gap-1.5";

const composerInputGroupBase =
  "[&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:flex-col [&_[data-slot=input-group]]:items-stretch [&_[data-slot=input-group]]:gap-0 [&_[data-slot=input-group]]:p-2 sm:[&_[data-slot=input-group]]:p-2.5";

/** Chat composer InputGroup: solid face, no focus ring (streaming rim is the active cue). */
export const composerInputGroupClass =
  "chat-composer-input @container/composer overflow-visible has-[[data-slot=input-group-control]:focus-visible]:border-border has-[[data-slot=input-group-control]:focus-visible]:ring-0";

/** First shelf panel rounds its top; later panels stay flush. */
export type ComposerStackEdge = "start" | "continue";

export function composerShelfPanelClass(
  edge: ComposerStackEdge = "start"
): string {
  return cn(
    "relative z-0 mx-auto w-[calc(100%-2.5rem)] shrink-0 overflow-hidden border border-border border-b-0 bg-card shadow-xs",
    edge === "start" ? "rounded-t-2xl rounded-b-none" : "rounded-none"
  );
}

export const composerShellClass = cn(
  composerInputGroupBase,
  "[&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:border [&_[data-slot=input-group]]:border-border [&_[data-slot=input-group]]:shadow-xs [&_[data-slot=input-group]]:transition-[box-shadow,border-color]"
);

export const composerShellCompactClass =
  "[&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:flex-col [&_[data-slot=input-group]]:items-stretch [&_[data-slot=input-group]]:gap-0 [&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:border-border [&_[data-slot=input-group]]:p-2.5 [&_[data-slot=input-group]]:shadow-xs [&_[data-slot=input-group]]:transition-[box-shadow,border-color]";
