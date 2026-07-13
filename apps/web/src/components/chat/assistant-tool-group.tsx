import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import type { ChatListItem } from "@/lib/chat-history";
import {
  formatSubAgentSubtitle,
  formatSubAgentTitle,
  formatSubAgentToolResult,
  formatToolActionLabel,
  formatToolCommand,
  formatToolResult,
  isSubAgentTool,
  parseSubAgentResult,
} from "@/lib/chat-stream";
import { ThinkingContent } from "@/components/chat/thinking-content";
import { cn } from "@/lib/utils";

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

export function AssistantTurnSegmentView({
  segment,
  showThinking = true,
  modelLabel,
}: {
  segment: AssistantTurnSegment;
  showThinking?: boolean;
  modelLabel?: string | null;
}) {
  if (segment.kind === "work") {
    return (
      <AssistantWorkGroup
        thinking={showThinking ? segment.thinking : undefined}
        tools={segment.tools}
        modelLabel={modelLabel}
      />
    );
  }

  return (
    <Message from="assistant" className="max-w-full mr-0 ml-0 items-start justify-start">
      <MessageContent className="max-w-full ml-0 group-[.is-user]:ml-0">
        {showThinking && segment.thinking ? <ThinkingBlock message={segment.thinking} /> : null}
        <AssistantTextContent message={segment.message} />
      </MessageContent>
    </Message>
  );
}

function AssistantTextContent({ message }: { message: ChatListItem }) {
  return (
    <MessageResponse isAnimating={Boolean(message.streaming && !message.thinkingStreaming)}>
      {message.content || "…"}
    </MessageResponse>
  );
}

function AssistantWorkGroup({
  thinking,
  tools,
  modelLabel,
}: {
  thinking?: ChatListItem;
  tools: ChatListItem[];
  modelLabel?: string | null;
}) {
  if (tools.length === 0) {
    return thinking ? <ThinkingBlock message={thinking} /> : null;
  }

  const hasRunningTools = tools.some((tool) => tool.toolStatus === "running");
  const isThinking = Boolean(thinking?.thinkingStreaming);
  const subAgentOnly = tools.every((tool) => isSubAgentTool(tool.tool));
  const [open, setOpen] = useState(hasRunningTools || isThinking || subAgentOnly);

  useEffect(() => {
    if (hasRunningTools || isThinking) {
      setOpen(true);
    }
  }, [hasRunningTools, isThinking]);

  if (subAgentOnly) {
    return (
      <div className="w-full max-w-full space-y-3">
        {thinking ? <ThinkingBlock message={thinking} /> : null}
        {tools.map((tool) => (
          <SubAgentToolRow key={tool.id} message={tool} modelLabel={modelLabel} />
        ))}
      </div>
    );
  }

  const label = formatWorkGroupLabel(tools.length);

  return (
    <div className="w-full max-w-full">
      <CollapsibleTrigger
        open={open}
        onToggle={() => setOpen((current) => !current)}
        label={label}
      />
      {open ? (
        <TimelineBody>
          {thinking ? <ThinkingInline message={thinking} isLast={tools.length === 0} /> : null}
          {tools.map((tool, index) =>
            isSubAgentTool(tool.tool) ? (
              <div key={tool.id} className={cn("relative", index < tools.length - 1 && "pb-3")}>
                <SubAgentToolRow message={tool} modelLabel={modelLabel} />
              </div>
            ) : (
              <ToolTimelineItem
                key={tool.id}
                message={tool}
                isLast={index === tools.length - 1}
              />
            ),
          )}
        </TimelineBody>
      ) : null}
    </div>
  );
}

function formatWorkGroupLabel(toolCount: number): string {
  if (toolCount === 1) {
    return "Called 1 tool";
  }

  return `Called ${toolCount} tools`;
}

function ThinkingBlock({ message }: { message: ChatListItem }) {
  const isStreaming = Boolean(message.thinkingStreaming);
  const text = message.thinking?.trim();
  const shouldAutoOpen = Boolean(text) && Boolean(message.streaming);
  const [open, setOpen] = useState(isStreaming || shouldAutoOpen);

  useEffect(() => {
    if (isStreaming || shouldAutoOpen) {
      setOpen(true);
    }
  }, [isStreaming, shouldAutoOpen]);

  if (!text && !isStreaming) {
    return null;
  }

  return (
    <div className="w-full max-w-full">
      <CollapsibleTrigger
        open={open}
        onToggle={() => setOpen((current) => !current)}
        label={isStreaming ? "Thinking…" : "Thought"}
        labelClassName={isStreaming ? "thinking-shimmer-text" : undefined}
      />
      {open && text ? (
        <ThinkingContent className="mt-2 pl-5">{text}</ThinkingContent>
      ) : null}
    </div>
  );
}

function ThinkingInline({
  message,
  isLast,
}: {
  message: ChatListItem;
  isLast: boolean;
}) {
  const text = message.thinking?.trim();

  if (!text) {
    return null;
  }

  return (
    <div className={cn("relative", !isLast && "pb-3")}>
      <ThinkingContent>{text}</ThinkingContent>
    </div>
  );
}

function formatElapsedSeconds(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;

  return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
}

function useElapsedSeconds(active: boolean, startedAt?: string): number {
  const anchorRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      anchorRef.current = null;
      setElapsed(0);
      return;
    }

    if (anchorRef.current === null) {
      const parsed = startedAt ? new Date(startedAt).getTime() : Number.NaN;
      anchorRef.current = Number.isNaN(parsed) ? Date.now() : parsed;
    }

    const update = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - anchorRef.current!) / 1000)));
    };

    update();
    const intervalId = window.setInterval(update, 1000);
    return () => window.clearInterval(intervalId);
  }, [active, startedAt]);

  return elapsed;
}

function SubAgentToolRow({
  message,
  modelLabel,
}: {
  message: ChatListItem;
  modelLabel?: string | null;
}) {
  const isRunning = message.toolStatus === "running";
  const elapsedSeconds = useElapsedSeconds(isRunning, message.createdAt);
  const title = formatSubAgentTitle(message.toolInput);
  const subtitle = formatSubAgentSubtitle(message.toolInput, message.toolResult, isRunning);
  const parsed = message.toolStatus === "done" ? parseSubAgentResult(message.toolResult) : null;
  const output =
    message.toolStatus === "done" ? formatSubAgentToolResult(message.toolResult) : null;
  const hasExpandableOutput = Boolean(output && (!parsed?.summary || output !== parsed.summary));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isRunning) {
      setOpen(false);
    }
  }, [isRunning]);

  const statusTone =
    parsed?.status === "fail"
      ? "text-red-600 dark:text-red-400"
      : parsed?.status === "timeout"
        ? "text-amber-700 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <div className="w-full max-w-full space-y-2">
      <div className="flex min-w-0 items-start gap-2.5">
        <SubAgentMark
          className={cn(
            "mt-0.5 size-4 shrink-0",
            isRunning ? "text-foreground/70" : "text-muted-foreground",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</p>
            {modelLabel ? (
              <span className="shrink-0 text-xs text-muted-foreground">{modelLabel}</span>
            ) : null}
          </div>
          <p className={cn("mt-0.5 truncate text-sm", statusTone)}>{subtitle}</p>
        </div>
      </div>

      {isRunning ? (
        <div className="flex items-center gap-2 pl-6 text-sm">
          <span className="todo-shimmer-text">Waiting for subagent</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatElapsedSeconds(elapsedSeconds)}
          </span>
        </div>
      ) : null}

      {!isRunning && hasExpandableOutput ? (
        <div className="pl-6">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className="flex items-center gap-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDownIcon
              className={cn(
                "size-3.5 shrink-0 transition-transform duration-200",
                !open && "-rotate-90",
              )}
              aria-hidden
            />
            <span>{open ? "Hide full output" : "Show full output"}</span>
          </button>
          {open && output ? <DetailBlock label="Output" content={output} tone="output" /> : null}
        </div>
      ) : null}

      {!isRunning && !hasExpandableOutput && output ? (
        <div className="pl-6">
          <DetailBlock label="Output" content={output} tone="output" />
        </div>
      ) : null}
    </div>
  );
}

function SubAgentMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <circle cx="8" cy="3.5" r="1.6" fill="currentColor" />
      <circle cx="3.5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12.5" cy="12" r="1.6" fill="currentColor" />
      <path
        d="M7.2 4.8 4.4 10.4M8.8 4.8l2.8 5.6M5.2 12h5.6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ToolTimelineItem({
  message,
  isLast,
}: {
  message: ChatListItem;
  isLast: boolean;
}) {
  const isRunning = message.toolStatus === "running";
  const label = formatToolActionLabel(message.tool, message.toolInput);
  const command = formatToolCommand(message.tool, message.toolInput);
  const output =
    message.toolStatus === "done"
      ? formatToolResult(message.tool, message.toolResult)
      : null;
  const hasDetails = Boolean(isRunning || command || output);
  const [open, setOpen] = useState(isRunning);

  useEffect(() => {
    if (isRunning) {
      setOpen(true);
      return;
    }

    if (message.toolStatus === "done") {
      setOpen(false);
    }
  }, [isRunning, message.toolStatus]);

  return (
    <div className={cn("relative", !isLast && "pb-3")}>
      <CollapsibleTrigger
        open={open}
        onToggle={() => hasDetails && setOpen((current) => !current)}
        label={label}
        disabled={!hasDetails}
        className="pl-0"
      />
      {open && hasDetails ? (
        <div className="mt-2 space-y-2">
          {command ? <DetailBlock label="Command" content={command} tone="command" /> : null}
          {isRunning ? (
            <p className="font-mono text-xs text-muted-foreground">Waiting for output…</p>
          ) : output ? (
            <DetailBlock label="Output" content={output} tone="output" />
          ) : command ? null : (
            <p className="font-mono text-xs text-muted-foreground">No output returned.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CollapsibleTrigger({
  open,
  onToggle,
  label,
  labelClassName,
  disabled = false,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  labelClassName?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={disabled ? undefined : open}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground",
        className,
      )}
    >
      {disabled ? (
        <span className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-200",
            !open && "-rotate-90",
          )}
          aria-hidden
        />
      )}
      <span className={cn("min-w-0 flex-1 truncate", labelClassName)}>{label}</span>
    </button>
  );
}

function TimelineBody({ children }: { children: ReactNode }) {
  return (
    <div className="relative mt-2 ml-1 border-l border-border/70 pl-3">{children}</div>
  );
}

function DetailBlock({
  label,
  content,
  tone,
}: {
  label: string;
  content: string;
  tone: "command" | "output";
}) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border/70 bg-muted/20">
      <div className="border-b border-border/70 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <pre
        className={cn(
          "max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-relaxed",
          tone === "output" ? "text-emerald-700 dark:text-emerald-300" : "text-foreground",
        )}
      >
        {content}
      </pre>
    </div>
  );
}

// Keep export for any external usage/tests.
export const AssistantToolGroup = AssistantWorkGroup;
