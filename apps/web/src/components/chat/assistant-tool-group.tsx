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
import { isWebSearchTool } from "@/lib/chat-stream-web-search";
import { isWebFetchTool } from "@/lib/chat-stream-web-fetch";
import {
  shouldRenderWebSearchToolRow,
  WebSearchToolRow,
} from "@/components/chat/WebSearchToolRow";
import {
  shouldRenderWebFetchToolRow,
  WebFetchToolRow,
} from "@/components/chat/WebFetchToolRow";
import { isArtifactMetaSidecarTool } from "@/lib/chat-artifacts";
import { ThinkingReasoning } from "@/components/chat/ThinkingReasoning";
import { cn } from "@/lib/utils";

import {
  type AssistantTurnSegment,
} from "@/components/chat/assistant-tool-group.shared";
export function AssistantTurnSegmentView({
  segment,
  showThinking = true,
  modelLabel,
  turnComplete = false,
}: {
  segment: AssistantTurnSegment;
  showThinking?: boolean;
  modelLabel?: string | null;
  turnComplete?: boolean;
}) {
  if (segment.kind === "work") {
    return (
      <AssistantWorkGroup
        thinking={showThinking ? segment.thinking : undefined}
        tools={segment.tools}
        modelLabel={modelLabel}
        turnComplete={turnComplete}
      />
    );
  }

  return (
    <Message from="assistant" className="max-w-full mr-0 ml-0 items-start justify-start">
      <MessageContent className="max-w-full ml-0 group-[.is-user]:ml-0">
        {showThinking && segment.thinking ? (
          <ThinkingBlock message={segment.thinking} turnComplete={turnComplete} />
        ) : null}
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
  turnComplete = false,
}: {
  thinking?: ChatListItem;
  tools: ChatListItem[];
  modelLabel?: string | null;
  turnComplete?: boolean;
}) {
  const visibleTools = tools.filter((tool) => !isArtifactMetaSidecarTool(tool));
  const isThinkingStreaming = Boolean(thinking?.thinkingStreaming);
  const hasRunningTools = visibleTools.some((tool) => tool.toolStatus === "running");
  const isWorkActive = !turnComplete || isThinkingStreaming || hasRunningTools;

  if (visibleTools.length === 0) {
    return thinking ? (
      <ThinkingBlock message={thinking} turnComplete={turnComplete} />
    ) : null;
  }

  if (!thinking) {
    return (
      <ToolOnlyWorkGroup
        tools={visibleTools}
        modelLabel={modelLabel}
        turnComplete={turnComplete}
      />
    );
  }

  return (
    <ThinkingReasoning
      text={thinking.thinking ?? ""}
      isThinkingStreaming={isThinkingStreaming}
      isWorkActive={isWorkActive}
      startedAt={thinking.createdAt}
      className="w-full max-w-full"
    >
      {visibleTools.map((tool, index) =>
        isDedicatedTool(tool) ? (
          <DedicatedToolRow
            key={tool.id}
            message={tool}
            modelLabel={modelLabel}
            isLast={index === visibleTools.length - 1}
          />
        ) : (
          <ToolTimelineItem
            key={tool.id}
            message={tool}
            isLast={index === visibleTools.length - 1}
          />
        ),
      )}
    </ThinkingReasoning>
  );
}

function ToolOnlyWorkGroup({
  tools,
  modelLabel,
  turnComplete = false,
}: {
  tools: ChatListItem[];
  modelLabel?: string | null;
  turnComplete?: boolean;
}) {
  const hasRunningTools = tools.some((tool) => tool.toolStatus === "running");
  const isWorkActive = !turnComplete || hasRunningTools;
  const [open, setOpen] = useState(isWorkActive);

  useEffect(() => {
    if (isWorkActive) {
      setOpen(true);
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delay = reducedMotion ? 0 : 360;
    const timerId = window.setTimeout(() => setOpen(false), delay);
    return () => window.clearTimeout(timerId);
  }, [isWorkActive]);

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
          {tools.map((tool, index) =>
            isDedicatedTool(tool) ? (
              <div key={tool.id} className={cn("relative", index < tools.length - 1 && "pb-3")}>
                <DedicatedToolRow
                  message={tool}
                  modelLabel={modelLabel}
                  isLast={index === tools.length - 1}
                />
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

function ThinkingBlock({
  message,
  turnComplete = false,
}: {
  message: ChatListItem;
  turnComplete?: boolean;
}) {
  const isThinkingStreaming = Boolean(message.thinkingStreaming);
  const isWorkActive =
    !turnComplete ||
    isThinkingStreaming ||
    Boolean(message.streaming && !message.content.trim());

  return (
    <ThinkingReasoning
      text={message.thinking ?? ""}
      isThinkingStreaming={isThinkingStreaming}
      isWorkActive={isWorkActive}
      startedAt={message.createdAt}
      className="w-full max-w-full"
    />
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

function isDedicatedTool(tool: ChatListItem): boolean {
  return (
    isSubAgentTool(tool.tool) ||
    shouldRenderWebSearchToolRow(tool) ||
    shouldRenderWebFetchToolRow(tool)
  );
}

function DedicatedToolRow({
  message,
  modelLabel,
  isLast = false,
}: {
  message: ChatListItem;
  modelLabel?: string | null;
  isLast?: boolean;
}) {
  if (isWebFetchTool(message.tool)) {
    if (shouldRenderWebFetchToolRow(message)) {
      return <WebFetchToolRow message={message} />;
    }

    return <ToolTimelineItem message={message} isLast={isLast} />;
  }

  if (isWebSearchTool(message.tool)) {
    if (shouldRenderWebSearchToolRow(message)) {
      return <WebSearchToolRow message={message} />;
    }

    return <ToolTimelineItem message={message} isLast={isLast} />;
  }

  return <SubAgentToolRow message={message} modelLabel={modelLabel} />;
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
          active={isRunning}
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

function SubAgentMark({ className, active }: { className?: string; active?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(active && "subagent-mark-active", className)}
      aria-hidden
    >
      <circle className="subagent-dot subagent-dot-top" cx="8" cy="3.5" r="1.6" fill="currentColor" />
      <circle className="subagent-dot subagent-dot-br" cx="12.5" cy="12" r="1.6" fill="currentColor" />
      <circle className="subagent-dot subagent-dot-bl" cx="3.5" cy="12" r="1.6" fill="currentColor" />
      <path
        className="subagent-edge subagent-edge-top-br"
        pathLength={1}
        d="M8.8 4.8 11.6 10.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        className="subagent-edge subagent-edge-br-bl"
        pathLength={1}
        d="M10.8 12 5.2 12"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        className="subagent-edge subagent-edge-bl-top"
        pathLength={1}
        d="M4.4 10.4 7.2 4.8"
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
