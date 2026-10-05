import { Button } from "@nakama/ui/button";
import { cn } from "@nakama/ui/utils";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Audit02Icon,
  BookOpen01Icon,
  ComputerTerminal01Icon,
  McpServerIcon,
  PropertySearchIcon,
  Rotate02Icon,
  TaskEdit01Icon,
  Wrench01Icon,
} from "hugeicons-react";
import type { MouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  type AssistantTurnSegment,
  formatLocalCitations,
  type LocalFileCitation,
  toolGroupElapsedSeconds,
} from "@/components/chat/assistant-tool-group.shared";
import { ImageGenerationToolRow } from "@/components/chat/ImageGenerationToolRow";
import { ThinkingReasoning } from "@/components/chat/ThinkingReasoning";
import thinkingStyles from "@/components/chat/ThinkingReasoning.module.css";
import { WebFetchToolRow } from "@/components/chat/WebFetchToolRow";
import { WebSearchToolRow } from "@/components/chat/WebSearchToolRow";
import { WorkflowRunToolRow } from "@/components/chat/WorkflowRunToolRow";
import { WorkspaceFilePreview } from "@/components/chat/workspace-file-preview";
import { PluginSurface } from "@/components/PluginSurface";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useAuth } from "@/context/use-auth";
import { useTheme } from "@/context/use-theme";
import { useOrgPlugins } from "@/hooks/use-plugins";
import { useRafCoalescedValue } from "@/hooks/use-raf-coalesced-value";
import { isArtifactMetaSidecarTool } from "@/lib/chat-artifacts";
import { buildNewChatPath, type ChatListItem } from "@/lib/chat-history";
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
import { client, formatError } from "@/lib/client";
import { formatElapsedSeconds, useElapsedSeconds } from "@/lib/elapsed-time";
import { findPluginTool } from "@/lib/plugin-runtime";
import { splitStreamingMarkdown } from "@/lib/streaming-markdown-seal";
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
        active={segment.active ?? false}
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
          profileId={profileId}
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
  profileId,
  onRetry,
  retryDisabled = false,
}: {
  message: ChatListItem;
  profileId?: string | null;
  onRetry?: () => void;
  retryDisabled?: boolean;
}) {
  const { user } = useAuth();
  const streaming = Boolean(message.streaming && !message.thinkingStreaming);
  const content = useRafCoalescedValue(message.content, streaming);
  const citedProfileId = user?.isPlatformAdmin ? profileId : null;
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const closePreview = useCallback(() => setPreviewPath(null), []);

  function openCitation(event: MouseEvent<HTMLElement>) {
    const link =
      event.target instanceof Element
        ? event.target.closest('a[href^="#file-citation?"]')
        : null;
    if (!(link && event.currentTarget.contains(link))) {
      return;
    }
    const query = new URLSearchParams(
      link.getAttribute("href")?.split("?")[1] ?? ""
    );
    const path = query.get("file");
    if (!path || query.get("profile") !== citedProfileId) {
      return;
    }
    event.preventDefault();
    setPreviewPath(path);
  }

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
    const { markdown, citations } = formatLocalCitations(
      content,
      citedProfileId
    );
    return (
      <div
        className="flex w-full min-w-0 flex-col gap-0"
        onClick={openCitation}
      >
        <MessageResponse>{markdown || "…"}</MessageResponse>
        <LocalCitationFooter citations={citations} />
        {previewPath && citedProfileId ? (
          <LocalCitationPreview
            key={previewPath}
            onClose={closePreview}
            path={previewPath}
            profileId={citedProfileId}
          />
        ) : null}
      </div>
    );
  }

  const { sealed, tail } = splitStreamingMarkdown(content);
  const { markdown } = formatLocalCitations(sealed, citedProfileId);

  return (
    <div className="flex w-full min-w-0 flex-col gap-0" onClick={openCitation}>
      {sealed ? (
        <MessageResponse isAnimating={false} mode="streaming">
          {markdown}
        </MessageResponse>
      ) : null}
      {tail || !sealed ? <StreamingPlainTail text={tail} /> : null}
      {previewPath && citedProfileId ? (
        <LocalCitationPreview
          key={previewPath}
          onClose={closePreview}
          path={previewPath}
          profileId={citedProfileId}
        />
      ) : null}
    </div>
  );
}

function LocalCitationPreview({
  path,
  profileId,
  onClose,
}: {
  path: string;
  profileId: string;
  onClose: () => void;
}) {
  const { activeOrg } = useAuth();
  const folder = path.slice(0, path.lastIndexOf("/"));
  const { data, error } = useQuery({
    queryFn: () => client.listProfileWorkspaceFiles(profileId, folder),
    queryKey: ["citation-file", activeOrg?.id, profileId, folder],
  });
  const entry = data?.entries.find(
    (candidate) => candidate.kind === "file" && candidate.path === path
  );
  if (entry) {
    return (
      <WorkspaceFilePreview
        entry={entry}
        id={`citation:${profileId}:${path}`}
        onClose={onClose}
        profileId={profileId}
      />
    );
  }
  if (error || data) {
    return (
      <p className="text-destructive text-sm" role="alert">
        {error ? formatError(error) : "File not found."}
      </p>
    );
  }
  return null;
}

function LocalCitationFooter({
  citations,
}: {
  citations: LocalFileCitation[];
}) {
  if (citations.length === 0) {
    return null;
  }
  return (
    <div
      aria-label="Sources"
      className="mt-3 flex flex-wrap gap-1.5 border-border/60 border-t pt-2 text-xs"
    >
      {citations.map(({ href, label, number, path }) => (
        <a
          aria-label={`Open ${label} in file preview`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
          href={href}
          key={path}
          title={path}
        >
          <span className="font-semibold text-primary">{number}</span>
          <span className="truncate">{label}</span>
          <span className="truncate text-muted-foreground">· {path}</span>
        </a>
      ))}
    </div>
  );
}

function PluginToolRow({ message }: { message: ChatListItem }) {
  const plugins = useOrgPlugins().data ?? [];
  const match = findPluginTool(plugins, message.tool);
  const { activeOrg } = useAuth();
  const { resolvedTheme } = useTheme();
  const plugin = match?.plugin;
  const fallback = <ToolTimelineItem message={message} />;
  if (
    !(match && activeOrg) ||
    activeOrg.role === "viewer" ||
    !plugin?.ui ||
    plugin.lifecycleState !== "enabled"
  ) {
    return fallback;
  }
  return (
    <PluginSurface
      fallback={fallback}
      key={`${activeOrg.id}:${plugin.pluginId}:${plugin.selectedVersion}:${plugin.revision}:${resolvedTheme}`}
      orgId={activeOrg.id}
      plugin={plugin}
      theme={resolvedTheme}
      tool={{
        action: match.action,
        input: message.toolInput,
        result: message.toolResult,
        status: message.toolStatus ?? "done",
      }}
    />
  );
}

function AssistantWorkGroup({
  active,
  thinking,
  tools,
  modelLabel,
  profileId,
}: {
  active: boolean;
  thinking?: ChatListItem;
  tools: ChatListItem[];
  modelLabel?: string | null;
  profileId?: string | null;
}) {
  const visibleTools = tools.filter(
    (tool) => !isArtifactMetaSidecarTool(tool) && tool.tool !== "create_profile"
  );

  if (visibleTools.length === 0 && !thinking && !active) {
    return null;
  }

  return (
    <OtherWorkGroup
      active={active}
      modelLabel={modelLabel}
      profileId={profileId}
      thinking={thinking}
      tools={visibleTools}
    />
  );
}

function OtherWorkGroup({
  active,
  thinking,
  tools,
  modelLabel,
  profileId,
}: {
  active: boolean;
  thinking?: ChatListItem;
  tools: ChatListItem[];
  modelLabel?: string | null;
  profileId?: string | null;
}) {
  const isThinkingStreaming = active && Boolean(thinking?.thinkingStreaming);
  const runningTool = tools.findLast((tool) => tool.toolStatus === "running");

  if (!thinking) {
    return (
      <ToolOnlyWorkGroup
        isWorkActive={active}
        modelLabel={modelLabel}
        profileId={profileId}
        tools={tools}
      />
    );
  }

  return (
    <ThinkingReasoning
      activityLabel={
        runningTool ? toolActivityLabel(runningTool.tool) : undefined
      }
      className="w-full max-w-full"
      isThinkingStreaming={isThinkingStreaming}
      isWorkActive={active}
      startedAt={thinking.createdAt}
      text={thinking.thinking ?? ""}
      thinkingDurationMs={
        tools.length === 0 && !active ? thinking.thinkingDurationMs : undefined
      }
      toolCount={tools.length}
    >
      {tools.map((tool, index) => (
        <TimelineStep isLast={index === tools.length - 1} key={tool.id}>
          <ToolRow
            message={tool}
            modelLabel={modelLabel}
            profileId={profileId}
          />
        </TimelineStep>
      ))}
    </ThinkingReasoning>
  );
}

function toolActivityLabel(tool: string | undefined): string {
  switch (tool) {
    case "web_search":
      return "Searching the web…";
    case "web_fetch":
      return "Reading webpage…";
    case "knowledge_base_search":
      return "Searching knowledge base…";
    case "search_files":
      return "Searching files…";
    case "read_file":
      return "Reading file…";
    case "bash":
      return "Running command…";
    default:
      return "Using tool…";
  }
}

function ToolOnlyWorkGroup({
  isWorkActive,
  tools,
  modelLabel,
  profileId,
}: {
  isWorkActive: boolean;
  tools: ChatListItem[];
  modelLabel?: string | null;
  profileId?: string | null;
}) {
  const [open, setOpen] = useState(true);
  const elapsedSeconds = useWorkDuration(isWorkActive, tools);

  const done = !isWorkActive;
  const expanded = open;
  const toolLabel = `${tools.length} ${tools.length === 1 ? "step" : "steps"}`;
  const runningTool = tools.findLast((tool) => tool.toolStatus === "running");

  return (
    <div className={cn(thinkingStyles.root, "w-full max-w-full")}>
      <button
        aria-expanded={expanded}
        aria-label="Toggle activity"
        className={cn(
          thinkingStyles.header,
          thinkingStyles.headerClickable,
          expanded && thinkingStyles.headerExpanded
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {done ? (
          <span className={thinkingStyles.label}>
            <span className={thinkingStyles.verb}>{toolLabel}</span>
            {elapsedSeconds === null
              ? null
              : ` · ${formatElapsedSeconds(elapsedSeconds)}`}
          </span>
        ) : (
          <span className={cn(thinkingStyles.label, thinkingStyles.shimmer)}>
            {runningTool ? toolActivityLabel(runningTool.tool) : "Working…"}
            {` · ${toolLabel}`}
            {elapsedSeconds === null
              ? null
              : ` · ${formatElapsedSeconds(elapsedSeconds)}`}
          </span>
        )}
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
      </button>

      <div
        aria-hidden={!expanded}
        className={cn(
          thinkingStyles.collapsible,
          !expanded && thinkingStyles.collapsibleCollapsed
        )}
      >
        <div className={thinkingStyles.inner}>
          <div
            className={cn(
              thinkingStyles.timeline,
              thinkingStyles.timelineWithTools
            )}
          >
            <div className={thinkingStyles.tools}>
              {tools.map((tool, index) => (
                <TimelineStep isLast={index === tools.length - 1} key={tool.id}>
                  <ToolRow
                    message={tool}
                    modelLabel={modelLabel}
                    profileId={profileId}
                  />
                </TimelineStep>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolRow({
  message,
  modelLabel,
  profileId,
}: {
  message: ChatListItem;
  modelLabel?: string | null;
  profileId?: string | null;
}) {
  if (message.tool?.startsWith("plugin_")) {
    return <PluginToolRow message={message} />;
  }

  if (isRunWorkflowTool(message.tool)) {
    return <WorkflowRunToolRow message={message} />;
  }

  if (isDedicatedTool(message)) {
    return (
      <DedicatedToolRow
        message={message}
        modelLabel={modelLabel}
        profileId={profileId}
      />
    );
  }

  return <ToolTimelineItem message={message} />;
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
      thinkingDurationMs={message.thinkingDurationMs}
    />
  );
}

function useWorkDuration(
  active: boolean,
  tools: ChatListItem[]
): number | null {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) {
      return;
    }
    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [active]);
  return toolGroupElapsedSeconds(tools, now, active);
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

export function ProfileCreatedCard({
  profile,
}: {
  profile: {
    hasAvatar: boolean;
    id: string;
    isSuper: boolean;
    name: string;
    updatedAt: string;
  };
}) {
  return (
    <div className="flex w-fit max-w-full items-center gap-3 rounded-xl bg-muted/40 p-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <ProfileAvatar profile={profile} size="sm" />
        <p className="truncate font-medium text-foreground text-sm">
          {profile.name}
        </p>
      </div>
      <Button
        className="min-h-10 shrink-0 rounded-lg transition-transform active:scale-[0.96]"
        render={<Link to={buildNewChatPath(profile.id)} />}
        size="sm"
        type="button"
        variant="outline"
      >
        Start conversation
        <ArrowRight01Icon aria-hidden className="size-4" />
      </Button>
    </div>
  );
}

function subAgentStatusTone(status: string | undefined): string {
  if (status === "fail") {
    return "text-red-600 dark:text-red-400";
  }
  if (status === "timeout") {
    return "text-amber-700 dark:text-amber-400";
  }
  return "text-muted-foreground";
}

function SubAgentToolHeader({
  activity,
  isRunning,
  modelLabel,
  statusTone,
  subtitle,
  title,
}: {
  activity: ChatListItem["subAgentActivity"];
  isRunning: boolean;
  modelLabel?: string | null;
  statusTone: string;
  subtitle: string;
  title: string;
}) {
  return (
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
  );
}

function SubAgentRunningFooter({
  activity,
  elapsedSeconds,
}: {
  activity: ChatListItem["subAgentActivity"];
  elapsedSeconds: number;
}) {
  return (
    <div className="flex items-center gap-2 pl-6 text-muted-foreground text-xs tabular-nums">
      {activity ? null : (
        <span className="todo-shimmer-text text-muted-foreground text-sm">
          Waiting for subagent
        </span>
      )}
      <span>{formatElapsedSeconds(elapsedSeconds)}</span>
    </div>
  );
}

function SubAgentOutputSection({
  expanded,
  hasExpandableOutput,
  onToggle,
  output,
}: {
  expanded: boolean;
  hasExpandableOutput: boolean;
  onToggle: () => void;
  output: string | null;
}) {
  if (hasExpandableOutput) {
    return (
      <div className="pl-6">
        <button
          aria-expanded={expanded}
          className="flex w-full items-center gap-1 text-left text-muted-foreground text-sm transition-colors hover:text-foreground"
          onClick={onToggle}
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
    );
  }

  if (output) {
    return (
      <div className="pl-6">
        <DetailBlock content={output} label="Output" tone="output" />
      </div>
    );
  }

  return null;
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
  const parsed =
    message.toolStatus === "done"
      ? parseSubAgentResult(message.toolResult)
      : null;
  const output =
    message.toolStatus === "done"
      ? formatSubAgentToolResult(message.toolResult)
      : null;
  const [open, setOpen] = useState(false);

  return (
    <div className="w-full max-w-full space-y-2">
      <SubAgentToolHeader
        activity={message.subAgentActivity}
        isRunning={isRunning}
        modelLabel={modelLabel}
        statusTone={subAgentStatusTone(parsed?.status)}
        subtitle={formatSubAgentSubtitle(
          message.toolInput,
          message.toolResult,
          isRunning,
          message.subAgentActivity
        )}
        title={formatSubAgentTitle(message.toolInput)}
      />
      {isRunning ? (
        <SubAgentRunningFooter
          activity={message.subAgentActivity}
          elapsedSeconds={elapsedSeconds}
        />
      ) : (
        <SubAgentOutputSection
          expanded={open}
          hasExpandableOutput={Boolean(
            output && (!parsed?.summary || output !== parsed.summary)
          )}
          onToggle={() => setOpen((current) => !current)}
          output={output}
        />
      )}
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

function ToolTimelineOutput({
  command,
  isError,
  isRunning,
  output,
}: {
  command: string | null;
  isError: boolean;
  isRunning: boolean;
  output: string | null;
}) {
  if (isRunning) {
    return (
      <p className="font-mono text-muted-foreground text-xs">
        Waiting for output…
      </p>
    );
  }

  if (output) {
    return (
      <DetailBlock
        content={output}
        label={isError ? "Error" : "Output"}
        tone={isError ? "error" : "output"}
      />
    );
  }

  if (command) {
    return null;
  }

  return (
    <p className="font-mono text-muted-foreground text-xs">
      No output returned.
    </p>
  );
}

function ToolTimelineDetails({
  command,
  isError,
  isRunning,
  output,
  query,
}: {
  command: string | null;
  isError: boolean;
  isRunning: boolean;
  output: string | null;
  query: string | null;
}) {
  return (
    <div className="mt-2 space-y-2 pl-5">
      {command ? (
        <DetailBlock content={command} label="Command" tone="command" />
      ) : null}
      {query ? (
        <DetailBlock content={query} label="Query" tone="command" />
      ) : null}
      <ToolTimelineOutput
        command={command}
        isError={isError}
        isRunning={isRunning}
        output={output}
      />
    </div>
  );
}

function ToolTimelineItem({ message }: { message: ChatListItem }) {
  const isRunning = message.toolStatus === "running";
  const command =
    message.tool === "bash"
      ? formatToolCommand(message.tool, message.toolInput)
      : null;
  const output =
    message.toolStatus === "done"
      ? formatToolResult(message.tool, message.toolResult)
      : null;
  const query =
    typeof message.toolInput?.query === "string"
      ? message.toolInput.query.trim() || null
      : null;
  const isError =
    message.toolStatus === "done" &&
    isToolResultError(message.toolResult, output);
  const hasDetails = Boolean(isRunning || command || query || output);
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div>
      <CollapsibleTrigger
        className="pl-0"
        disabled={!hasDetails}
        label={formatToolActionLabel(message.tool, message.toolInput)}
        labelClassName={isError ? "text-red-600 dark:text-red-400" : undefined}
        onToggle={() => {
          if (hasDetails) {
            setDetailsOpen((current) => !current);
          }
        }}
        open={detailsOpen}
        tool={message.tool}
      />
      {detailsOpen && hasDetails ? (
        <ToolTimelineDetails
          command={command}
          isError={isError}
          isRunning={isRunning}
          output={output}
          query={query}
        />
      ) : null}
    </div>
  );
}

const TOOL_ICONS: Record<string, typeof Wrench01Icon> = {
  bash: ComputerTerminal01Icon,
  edit_file: TaskEdit01Icon,
  knowledge_base_search: PropertySearchIcon,
  read_file: BookOpen01Icon,
  search_files: Audit02Icon,
};

function CollapsibleTrigger({
  open,
  onToggle,
  label,
  labelClassName,
  disabled = false,
  className,
  tool,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  labelClassName?: string;
  disabled?: boolean;
  className?: string;
  tool?: string;
}) {
  const isMcpTool =
    tool?.includes("__") &&
    !tool.startsWith("plugin_") &&
    !tool.startsWith("composio__");
  const ToolIcon =
    (tool ? TOOL_ICONS[tool] : undefined) ??
    (isMcpTool ? McpServerIcon : Wrench01Icon);

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
      <span
        aria-hidden="true"
        className="relative z-10 flex h-5 w-3.5 shrink-0 items-center justify-center bg-background"
      >
        <ToolIcon className="size-3.5 text-muted-foreground opacity-50" />
      </span>
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
          "max-h-32 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-relaxed",
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
