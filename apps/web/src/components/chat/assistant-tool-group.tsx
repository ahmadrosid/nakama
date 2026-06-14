import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Spinner } from "@/components/ui/spinner";
import type { ChatListItem } from "@/lib/chat-history";
import {
  formatToolActionLabel,
  formatToolCommand,
  formatToolResult,
} from "@/lib/chat-stream";
import { cn } from "@/lib/utils";

export type AssistantTurnSegment =
  | { kind: "work"; thinking?: ChatListItem; tools: ChatListItem[] }
  | { kind: "text"; message: ChatListItem };

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
        segments.push({ kind: "text", message });
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

export function AssistantTurnSegmentView({ segment }: { segment: AssistantTurnSegment }) {
  if (segment.kind === "work") {
    return <AssistantWorkGroup thinking={segment.thinking} tools={segment.tools} />;
  }

  return (
    <Message from="assistant" className="max-w-full mr-0 ml-0 items-start justify-start">
      <MessageContent className="max-w-full ml-0 group-[.is-user]:ml-0">
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
}: {
  thinking?: ChatListItem;
  tools: ChatListItem[];
}) {
  if (thinking && tools.length === 0) {
    return <ThinkingBlock message={thinking} />;
  }

  const hasRunningTools = tools.some((tool) => tool.toolStatus === "running");
  const isThinking = Boolean(thinking?.thinkingStreaming);
  const [open, setOpen] = useState(hasRunningTools || isThinking);

  useEffect(() => {
    if (hasRunningTools || isThinking) {
      setOpen(true);
    }
  }, [hasRunningTools, isThinking]);

  const label = formatWorkGroupLabel(tools.length);

  return (
    <div className="w-full max-w-full">
      <CollapsibleTrigger
        open={open}
        onToggle={() => setOpen((current) => !current)}
        label={label}
        trailing={
          hasRunningTools || isThinking ? (
            <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null
        }
      />
      {open ? (
        <TimelineBody>
          {thinking ? <ThinkingInline message={thinking} isLast={tools.length === 0} /> : null}
          {tools.map((tool, index) => (
            <ToolTimelineItem
              key={tool.id}
              message={tool}
              isLast={index === tools.length - 1}
            />
          ))}
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
  const [open, setOpen] = useState(isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setOpen(true);
    }
  }, [isStreaming]);

  if (!text && !isStreaming) {
    return null;
  }

  return (
    <div className="w-full max-w-full">
      <CollapsibleTrigger
        open={open}
        onToggle={() => setOpen((current) => !current)}
        label={isStreaming ? "Thinking…" : "Thought"}
        trailing={
          isStreaming ? <Spinner className="size-3.5 shrink-0 text-muted-foreground" /> : null
        }
      />
      {open && text ? (
        <p className="mt-2 whitespace-pre-wrap pl-5 text-sm leading-relaxed text-muted-foreground">
          {text}
        </p>
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
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{text}</p>
    </div>
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
        trailing={
          isRunning ? <Spinner className="size-3.5 shrink-0 text-muted-foreground" /> : null
        }
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
  trailing,
  disabled = false,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  trailing?: ReactNode;
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
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
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
    <div className="overflow-hidden rounded-lg border border-border/70 bg-muted/20">
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
