import { ArrowDown01Icon, Rotate02Icon, Wrench01Icon } from "hugeicons-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import type { AssistantTurnSegment } from "@/components/chat/assistant-tool-group.shared";
import { ImageGenerationToolRow } from "@/components/chat/ImageGenerationToolRow";
import { ThinkingReasoning } from "@/components/chat/ThinkingReasoning";
import thinkingStyles from "@/components/chat/ThinkingReasoning.module.css";
import { WebFetchToolRow } from "@/components/chat/WebFetchToolRow";
import { WebSearchToolRow } from "@/components/chat/WebSearchToolRow";
import { WorkflowRunToolRow } from "@/components/chat/WorkflowRunToolRow";
import { Button } from "@/components/ui/button";
import { useRafCoalescedValue } from "@/hooks/use-raf-coalesced-value";
import { isArtifactMetaSidecarTool } from "@/lib/chat-artifacts";
import type { ChatListItem } from "@/lib/chat-history";
import {
  formatSubAgentSubtitle,
  formatSubAgentTitle,
  formatSubAgentToolResult,
  formatToolActionLabel,
  formatToolCommand,
  formatToolResult,
  isSubAgentTool,
  isToolResultError,
  parseSubAgentResult,
} from "@/lib/chat-stream";
import {
  isGenerateImageTool,
  shouldRenderGenerateImageToolRow,
} from "@/lib/chat-stream-image-generation";
import {
  isWebFetchTool,
  shouldRenderWebFetchToolRow,
} from "@/lib/chat-stream-web-fetch";
import {
  isWebSearchTool,
  shouldRenderWebSearchToolRow,
} from "@/lib/chat-stream-web-search";
import { isRunWorkflowTool } from "@/lib/chat-stream-workflow";
import { formatElapsedSeconds, useElapsedSeconds } from "@/lib/elapsed-time";
import { splitStreamingMarkdown } from "@/lib/streaming-markdown-seal";
import { cn } from "@/lib/utils";
export function AssistantTurnSegmentView({
  segment,
  showThinking = true,
  modelLabel,
  profileId,
  onRetryMessage,
  retryDisabled = false,
}: {
  segment: AssistantTurnSegment;
  showThinking?: boolean;
  modelLabel?: string | null;
  profileId?: string | null;
  onRetryMessage?: (message: ChatListItem) => void;
  retryDisabled?: boolean;
}) {
  if (segment.kind === "work") {
    return (
      <AssistantWorkGroup
        modelLabel={modelLabel}
        profileId={profileId}
        thinking={showThinking ? segment.thinking : undefined}
        tools={segment.tools}
      />
    );
  }

  return (
    <Message
      className="mr-0 ml-0 max-w-full items-start justify-start"
      from="assistant"
    >
      <MessageContent className="ml-0 w-full max-w-full gap-1 group-[.is-user]:ml-0">
        {showThinking && segment.thinking ? (
          <ThinkingBlock message={segment.thinking} />
        ) : null}
        <AssistantTextContent
          message={segment.message}
          onRetry={
            segment.message.failed && onRetryMessage
              ? () => onRetryMessage(segment.message)
              : undefined
          }
          retryDisabled={retryDisabled}
        />
      </MessageContent>
    </Message>
  );
}

function StreamingPlainTail({ text }: { text: string }) {
  return (
    <div
      className={cn(
        "chat-markdown size-full whitespace-pre-wrap break-words text-foreground",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      )}
    >
      {text || "…"}
    </div>
  );
}

function AssistantTextContent({
  message,
  onRetry,
  retryDisabled = false,
}: {
  message: ChatListItem;
  onRetry?: () => void;
  retryDisabled?: boolean;
}) {
  const streaming = Boolean(message.streaming && !message.thinkingStreaming);
  const content = useRafCoalescedValue(message.content, streaming);

  if (message.failed) {
    return (
      <div
        className="flex w-full min-w-0 flex-col gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5"
        role="alert"
      >
        <div className="flex flex-col gap-1">
          <span className="font-medium text-destructive text-xs">Failed</span>
          <p className="text-destructive/90 text-sm leading-relaxed">
            {content || "The model did not respond."}
          </p>
        </div>
        {onRetry ? (
          <Button
            className="w-fit border-destructive/30 bg-background text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={retryDisabled}
            onClick={onRetry}
            size="sm"
            type="button"
            variant="outline"
          >
            <Rotate02Icon aria-hidden className="size-3.5" />
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  if (!streaming) {
    return <MessageResponse>{content || "…"}</MessageResponse>;
  }

  const { sealed, tail } = splitStreamingMarkdown(content);

  return (
    <div className="flex w-full min-w-0 flex-col gap-0">
      {sealed ? (
        <MessageResponse isAnimating={false} mode="streaming">
          {sealed}
        </MessageResponse>
      ) : null}
      {tail || !sealed ? <StreamingPlainTail text={tail} /> : null}
    </div>
  );
}

function AssistantWorkGroup({
  thinking,
  tools,
  modelLabel,
  profileId,
}: {
  thinking?: ChatListItem;
  tools: ChatListItem[];
  modelLabel?: string | null;
  profileId?: string | null;
}) {
  const visibleTools = tools.filter((tool) => !isArtifactMetaSidecarTool(tool));
  const workflowRunTools = visibleTools.filter((tool) =>
    isRunWorkflowTool(tool.tool)
  );
  const otherTools = visibleTools.filter(
    (tool) => !isRunWorkflowTool(tool.tool)
  );

  if (workflowRunTools.length === 0 && otherTools.length === 0 && !thinking) {
    return null;
  }

  return (
    <div className="flex w-full max-w-full flex-col gap-3">
      <OtherWorkGroup
        modelLabel={modelLabel}
        profileId={profileId}
        thinking={thinking}
        tools={otherTools}
      />
      {workflowRunTools.map((tool) => (
        <WorkflowRunToolRow key={tool.id} message={tool} />
      ))}
    </div>
  );
}

function OtherWorkGroup({
  thinking,
  tools,
  modelLabel,
  profileId,
}: {
  thinking?: ChatListItem;
  tools: ChatListItem[];
  modelLabel?: string | null;
  profileId?: string | null;
}) {
  const isThinkingStreaming = Boolean(thinking?.thinkingStreaming);
  const hasRunningTools = tools.some((tool) => tool.toolStatus === "running");
  const isWorkActive = isThinkingStreaming || hasRunningTools;

  if (tools.length === 0) {
    return thinking ? <ThinkingBlock message={thinking} /> : null;
  }

  if (!thinking) {
    return (
      <ToolOnlyWorkGroup
        modelLabel={modelLabel}
        profileId={profileId}
        tools={tools}
      />
    );
  }

  return (
    <ThinkingReasoning
      className="w-full max-w-full"
      isThinkingStreaming={isThinkingStreaming}
      isWorkActive={isWorkActive}
      startedAt={thinking.createdAt}
      text={thinking.thinking ?? ""}
    >
      {tools.map((tool, index) => (
        <TimelineStep isLast={index === tools.length - 1} key={tool.id}>
          {isDedicatedTool(tool) ? (
            <DedicatedToolRow
              message={tool}
              modelLabel={modelLabel}
              profileId={profileId}
            />
          ) : (
            <ToolTimelineItem
              defaultDetailsOpen={tools.length === 1}
              message={tool}
            />
          )}
        </TimelineStep>
      ))}
    </ThinkingReasoning>
  );
}

function ToolOnlyWorkGroup({
  tools,
  modelLabel,
  profileId,
}: {
  tools: ChatListItem[];
  modelLabel?: string | null;
  profileId?: string | null;
}) {
  const hasRunningTools = tools.some((tool) => tool.toolStatus === "running");
  const isWorkActive = hasRunningTools;
  const [open, setOpen] = useState(isWorkActive);
  const elapsedSeconds = useWorkDuration(isWorkActive, tools[0]?.createdAt);

  useEffect(() => {
    if (isWorkActive) {
      setOpen(true);
      return;
    }

    if (tools.length === 1) {
      return;
    }

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const delay = reducedMotion ? 0 : 360;
    const timerId = window.setTimeout(() => setOpen(false), delay);
    return () => window.clearTimeout(timerId);
  }, [isWorkActive, tools.length]);

  const done = !isWorkActive;
  const expanded = done ? open : true;
  const toolLabel = tools.length === 1 ? "1 tool" : `${tools.length} tools`;

  return (
    <div className={cn(thinkingStyles.root, "w-full max-w-full")}>
      <button
        aria-expanded={expanded}
        aria-label="Toggle tools"
        className={cn(
          thinkingStyles.header,
          done && thinkingStyles.headerClickable,
          expanded && thinkingStyles.headerExpanded
        )}
        onClick={() => done && setOpen((current) => !current)}
        type="button"
      >
        {done ? (
          <span className={thinkingStyles.label}>
            <span className={thinkingStyles.verb}>Used</span> {toolLabel} ·{" "}
            {formatElapsedSeconds(elapsedSeconds)}
          </span>
        ) : (
          <span className={cn(thinkingStyles.label, thinkingStyles.shimmer)}>
            Working… · {formatElapsedSeconds(elapsedSeconds)}
          </span>
        )}
        {done ? (
          <svg
            aria-hidden="true"
            className={thinkingStyles.chevron}
            height="12"
            viewBox="0 0 24 24"
            width="12"
          >
            <path
              d="m4.5 15.75 7.5-7.5 7.5 7.5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
        ) : null}
      </button>

      <div
        className={cn(
          thinkingStyles.collapsible,
          !expanded && thinkingStyles.collapsibleCollapsed
        )}
      >
        <div className={thinkingStyles.inner}>
          <div className={thinkingStyles.timeline}>
            <div className={thinkingStyles.tools}>
              {tools.map((tool, index) => (
                <TimelineStep isLast={index === tools.length - 1} key={tool.id}>
                  {isDedicatedTool(tool) ? (
                    <DedicatedToolRow
                      message={tool}
                      modelLabel={modelLabel}
                      profileId={profileId}
                    />
                  ) : (
                    <ToolTimelineItem
                      defaultDetailsOpen={tools.length === 1}
                      message={tool}
                    />
                  )}
                </TimelineStep>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThinkingBlock({ message }: { message: ChatListItem }) {
  const isThinkingStreaming = Boolean(message.thinkingStreaming);
  const isWorkActive = isThinkingStreaming;

  return (
    <ThinkingReasoning
      className="w-full max-w-full"
      isThinkingStreaming={isThinkingStreaming}
      isWorkActive={isWorkActive}
      startedAt={message.createdAt}
      text={message.thinking ?? ""}
    />
  );
}

function useWorkDuration(active: boolean, startedAt?: string): number {
  const anchorRef = useRef<number | null>(null);
  const frozenRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(1);

  useEffect(() => {
    if (anchorRef.current === null) {
      const parsed = startedAt ? new Date(startedAt).getTime() : Number.NaN;
      anchorRef.current = Number.isNaN(parsed) ? Date.now() : parsed;
    }

    if (!active) {
      if (frozenRef.current === null) {
        frozenRef.current = Math.max(
          1,
          Math.floor((Date.now() - anchorRef.current) / 1000)
        );
      }
      setElapsed(frozenRef.current);
      return;
    }

    frozenRef.current = null;

    const update = () => {
      setElapsed(
        Math.max(1, Math.floor((Date.now() - anchorRef.current!) / 1000))
      );
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
    shouldRenderWebFetchToolRow(tool) ||
    shouldRenderGenerateImageToolRow(tool)
  );
}

function DedicatedToolRow({
  message,
  modelLabel,
  profileId,
}: {
  message: ChatListItem;
  modelLabel?: string | null;
  profileId?: string | null;
}) {
  if (isGenerateImageTool(message.tool)) {
    if (shouldRenderGenerateImageToolRow(message)) {
      return <ImageGenerationToolRow message={message} profileId={profileId} />;
    }

    return <ToolTimelineItem message={message} />;
  }

  if (isWebFetchTool(message.tool)) {
    if (shouldRenderWebFetchToolRow(message)) {
      return <WebFetchToolRow message={message} />;
    }

    return <ToolTimelineItem message={message} />;
  }

  if (isWebSearchTool(message.tool)) {
    if (shouldRenderWebSearchToolRow(message)) {
      return <WebSearchToolRow message={message} />;
    }

    return <ToolTimelineItem message={message} />;
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
  const activity = message.subAgentActivity;
  const subtitle = formatSubAgentSubtitle(
    message.toolInput,
    message.toolResult,
    isRunning,
    activity
  );
  const parsed =
    message.toolStatus === "done"
      ? parseSubAgentResult(message.toolResult)
      : null;
  const output =
    message.toolStatus === "done"
      ? formatSubAgentToolResult(message.toolResult)
      : null;
  const hasExpandableOutput = Boolean(
    output && (!parsed?.summary || output !== parsed.summary)
  );
  const [open, setOpen] = useState(false);
  const expanded = !isRunning && open;

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
            isRunning ? "text-foreground/70" : "text-muted-foreground"
          )}
        />
        <div className="min-w-0 flex-1">
          {modelLabel ? (
            <span className="block text-muted-foreground text-xs">
              {modelLabel}
            </span>
          ) : null}
          <p className="min-w-0 truncate font-medium text-foreground text-sm">
            {title}
          </p>
          <p
            className={cn(
              "mt-0.5 truncate text-sm",
              isRunning && activity
                ? "todo-shimmer-text font-medium text-foreground"
                : statusTone
            )}
          >
            {subtitle}
          </p>
        </div>
      </div>

      {isRunning ? (
        <div className="flex items-center gap-2 pl-6 text-muted-foreground text-xs tabular-nums">
          {activity ? null : (
            <span className="todo-shimmer-text text-muted-foreground text-sm">
              Waiting for subagent
            </span>
          )}
          <span>{formatElapsedSeconds(elapsedSeconds)}</span>
        </div>
      ) : null}

      {!isRunning && hasExpandableOutput ? (
        <div className="pl-6">
          <button
            aria-expanded={expanded}
            className="flex w-full items-center gap-1 text-left text-muted-foreground text-sm transition-colors hover:text-foreground"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            <span className="min-w-0 flex-1">
              {expanded ? "Hide full output" : "Show full output"}
            </span>
            <ArrowDown01Icon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 transition-transform duration-200",
                !expanded && "-rotate-90"
              )}
            />
          </button>
          {expanded && output ? (
            <DetailBlock content={output} label="Output" tone="output" />
          ) : null}
        </div>
      ) : null}

      {!(isRunning || hasExpandableOutput) && output ? (
        <div className="pl-6">
          <DetailBlock content={output} label="Output" tone="output" />
        </div>
      ) : null}
    </div>
  );
}

function SubAgentMark({
  className,
  active,
}: {
  className?: string;
  active?: boolean;
}) {
  return (
    <svg
      aria-hidden
      className={cn(active && "subagent-mark-active", className)}
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        className="subagent-dot subagent-dot-top"
        cx="8"
        cy="3.5"
        fill="currentColor"
        r="1.6"
      />
      <circle
        className="subagent-dot subagent-dot-br"
        cx="12.5"
        cy="12"
        fill="currentColor"
        r="1.6"
      />
      <circle
        className="subagent-dot subagent-dot-bl"
        cx="3.5"
        cy="12"
        fill="currentColor"
        r="1.6"
      />
      <path
        className="subagent-edge subagent-edge-top-br"
        d="M8.8 4.8 11.6 10.4"
        pathLength={1}
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.2"
      />
      <path
        className="subagent-edge subagent-edge-br-bl"
        d="M10.8 12 5.2 12"
        pathLength={1}
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.2"
      />
      <path
        className="subagent-edge subagent-edge-bl-top"
        d="M4.4 10.4 7.2 4.8"
        pathLength={1}
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function ToolTimelineItem({
  message,
  defaultDetailsOpen = false,
}: {
  message: ChatListItem;
  defaultDetailsOpen?: boolean;
}) {
  const isRunning = message.toolStatus === "running";
  const label = formatToolActionLabel(message.tool, message.toolInput);
  const command =
    message.tool === "bash"
      ? formatToolCommand(message.tool, message.toolInput)
      : null;
  const output =
    message.toolStatus === "done"
      ? formatToolResult(message.tool, message.toolResult)
      : null;
  const isError =
    message.toolStatus === "done" &&
    isToolResultError(message.toolResult, output);
  const hasDetails = Boolean(isRunning || command || output);
  const [detailsOpen, setDetailsOpen] = useState(defaultDetailsOpen);
  const [prevIsRunning, setPrevIsRunning] = useState(isRunning);

  if (isRunning !== prevIsRunning) {
    setPrevIsRunning(isRunning);
    if (isRunning) {
      setDetailsOpen(true);
    }
  }

  return (
    <div>
      <CollapsibleTrigger
        className="pl-0"
        disabled={!hasDetails}
        label={label}
        labelClassName={isError ? "text-red-600 dark:text-red-400" : undefined}
        onToggle={() => {
          if (hasDetails) {
            setDetailsOpen((current) => !current);
          }
        }}
        open={detailsOpen}
      />
      {detailsOpen && hasDetails ? (
        <div className="mt-2 space-y-2">
          {command ? (
            <DetailBlock content={command} label="Command" tone="command" />
          ) : null}
          {isRunning ? (
            <p className="font-mono text-muted-foreground text-xs">
              Waiting for output…
            </p>
          ) : output ? (
            <DetailBlock
              content={output}
              label={isError ? "Error" : "Output"}
              tone={isError ? "error" : "output"}
            />
          ) : command ? null : (
            <p className="font-mono text-muted-foreground text-xs">
              No output returned.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DefaultToolIcon({ className }: { className?: string }) {
  return (
    <Wrench01Icon
      aria-hidden
      className={cn("size-3.5 shrink-0 text-muted-foreground", className)}
    />
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
      aria-expanded={disabled ? undefined : open}
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 text-left text-muted-foreground text-sm transition-colors hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground",
        className
      )}
      disabled={disabled}
      onClick={onToggle}
      type="button"
    >
      <DefaultToolIcon />
      <span className={cn("min-w-0 flex-1 truncate", labelClassName)}>
        {label}
      </span>
      {disabled ? null : (
        <ArrowDown01Icon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-200",
            !open && "-rotate-90"
          )}
        />
      )}
    </button>
  );
}

function TimelineStep({
  children,
  isLast,
}: {
  children: ReactNode;
  isLast: boolean;
}) {
  return <div className={cn(!isLast && "pb-3")}>{children}</div>;
}

function DetailBlock({
  label,
  content,
  tone,
}: {
  label: string;
  content: string;
  tone: "command" | "output" | "error";
}) {
  return (
    <div
      className={cn(
        "mt-2 overflow-hidden rounded-lg border bg-muted/20",
        tone === "error"
          ? "border-red-300/70 dark:border-red-900/70"
          : "border-border/70"
      )}
    >
      <div
        className={cn(
          "border-b px-3 py-1.5 font-medium text-2xs uppercase tracking-[0.08em]",
          tone === "error"
            ? "border-red-300/70 text-red-600 dark:border-red-900/70 dark:text-red-400"
            : "border-border/70 text-muted-foreground"
        )}
      >
        {label}
      </div>
      <pre
        className={cn(
          "max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-relaxed",
          tone === "error"
            ? "text-red-700 dark:text-red-300"
            : tone === "output"
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-foreground"
        )}
      >
        {content}
      </pre>
    </div>
  );
}
