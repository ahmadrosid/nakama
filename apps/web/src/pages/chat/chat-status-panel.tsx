import type { AgentChannel, ProfileSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { cn } from "@nakama/ui/utils";
import {
  AiBrain01Icon,
  ArrowDown01Icon,
  File01Icon,
  Message01Icon,
  Plug01Icon,
  TaskDaily01Icon,
} from "hugeicons-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useArtifactAttachmentPreviewPanel } from "@/components/chat/use-artifact-attachment-preview-panel";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import { useProfileQuery } from "@/hooks/use-app-queries";
import {
  type ChatArtifactRef,
  extractTurnArtifacts,
} from "@/lib/chat-artifacts";
import {
  type ChatContextUsage,
  contextUsageRatio,
  contextUsageSegments,
  formatTokenCountDetailed,
} from "@/lib/chat-context-usage";
import {
  type ChatListItem,
  formatSessionChannelLabel,
} from "@/lib/chat-history";

/** One card of the status panel. The title toggles the body. */
function ChatStatusSection({
  aside,
  children,
  defaultOpen = true,
  title,
}: {
  aside?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  title: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-xl border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <button
          aria-expanded={open}
          className="-mx-1 flex items-center gap-1 rounded-md px-1 font-medium text-sm hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          {title}
          <ArrowDown01Icon
            aria-hidden
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              !open && "-rotate-90"
            )}
          />
        </button>
        {aside}
      </div>
      {open ? <ul className="mt-2 flex flex-col gap-0.5">{children}</ul> : null}
    </section>
  );
}

function ChatStatusRow({
  children,
  icon,
  trailing,
}: {
  children: ReactNode;
  icon: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <li className="flex min-h-7 items-center gap-2.5 text-sm">
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </li>
  );
}

const MCP_STATUS_DOT: Record<string, string> = {
  connected: "bg-emerald-500",
  error: "bg-destructive",
};

function ChatStatusArtifactRow({
  artifact,
  profileId,
}: {
  artifact: ChatArtifactRef;
  profileId: string;
}) {
  const { openPanel } = useArtifactAttachmentPreviewPanel({
    artifact,
    id: `chat-status:${artifact.path}`,
    profileId: artifact.ownerProfileId ?? profileId,
  });

  const type = artifact.filename.split(".").pop()?.toUpperCase();

  return (
    <li>
      <button
        className="-mx-1.5 flex min-h-7 w-[calc(100%+0.75rem)] items-center gap-2.5 rounded-md px-1.5 text-left text-sm hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={openPanel}
        type="button"
      >
        <File01Icon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate">{artifact.filename}</span>
        {type ? (
          <span className="shrink-0 text-muted-foreground text-xs">{type}</span>
        ) : null}
      </button>
    </li>
  );
}

interface ChatStatusProps {
  channel: AgentChannel;
  contextUsage: ChatContextUsage | null;
  messages: ChatListItem[];
  modelLabel: ReactNode;
  profile: ProfileSummary | undefined;
  profileId: string;
}

const CHAT_STATUS_PANEL_ID = "chat-status";

/**
 * Session bar button that opens the chat status in the right side panel:
 * agent, model and channel, context use, MCP servers and files the agent made.
 */
export function ChatStatusButton({
  channel,
  contextUsage,
  messages,
  modelLabel,
  profile,
  profileId,
}: ChatStatusProps) {
  const { activeId, hide, show, update } = useChatAttachmentPanel();
  const open = activeId === CHAT_STATUS_PANEL_ID;

  const content = useMemo(
    () => (
      <ChatStatusBody
        channel={channel}
        contextUsage={contextUsage}
        messages={messages}
        modelLabel={modelLabel}
        profile={profile}
        profileId={profileId}
      />
    ),
    [channel, contextUsage, messages, modelLabel, profile, profileId]
  );

  // The panel keeps the content it was opened with, so push new chat state in.
  useEffect(() => {
    if (open) {
      update(CHAT_STATUS_PANEL_ID, { content });
    }
  }, [content, open, update]);

  return (
    <Button
      aria-label="Chat status"
      aria-pressed={open}
      className={cn(
        "text-muted-foreground",
        open && "bg-accent text-foreground"
      )}
      onClick={() =>
        open
          ? hide(CHAT_STATUS_PANEL_ID)
          : show({
              bodyClassName: "flex flex-col gap-2 p-3",
              content,
              fixedWidth: 340,
              id: CHAT_STATUS_PANEL_ID,
              title: "Status",
            })
      }
      size="icon-sm"
      variant="ghost"
    >
      <TaskDaily01Icon aria-hidden className="size-4" />
    </Button>
  );
}

function ChatStatusBody({
  channel,
  contextUsage,
  messages,
  modelLabel,
  profile,
  profileId,
}: ChatStatusProps) {
  const detail = useProfileQuery(profileId);
  const servers = detail.data?.mcpServers ?? [];

  const artifacts = useMemo(() => {
    // Newest first, one row per file.
    const byPath = new Map<string, ChatArtifactRef>();

    for (const artifact of extractTurnArtifacts(messages).reverse()) {
      const key = `${artifact.ownerProfileId ?? ""}:${artifact.path}`;

      if (!byPath.has(key)) {
        byPath.set(key, artifact);
      }
    }

    return [...byPath.values()];
  }, [messages]);

  const ratio = contextUsage ? contextUsageRatio(contextUsage) : 0;

  return (
    <>
      <ChatStatusSection title="Environment">
        <ChatStatusRow
          icon={profile ? <ProfileAvatar profile={profile} size="xxs" /> : null}
        >
          {profile?.name ?? "Agent"}
        </ChatStatusRow>
        <ChatStatusRow icon={<AiBrain01Icon aria-hidden className="size-4" />}>
          {modelLabel}
        </ChatStatusRow>
        <ChatStatusRow icon={<Message01Icon aria-hidden className="size-4" />}>
          {formatSessionChannelLabel(channel)}
        </ChatStatusRow>
      </ChatStatusSection>

      {contextUsage ? (
        <ChatStatusSection
          aside={
            <span className="flex items-center gap-2 text-muted-foreground text-xs tabular-nums">
              {Math.round(ratio * 100)}%
              <span
                aria-hidden
                className="h-1.5 w-10 overflow-hidden rounded-full bg-muted"
              >
                <span
                  className={cn(
                    "block h-full rounded-full",
                    ratio >= 0.9
                      ? "bg-destructive"
                      : ratio >= 0.75
                        ? "bg-amber-500"
                        : "bg-primary"
                  )}
                  style={{ width: `${Math.max(ratio * 100, 4)}%` }}
                />
              </span>
            </span>
          }
          defaultOpen={false}
          title="Context"
        >
          {contextUsageSegments(contextUsage).map((segment) => (
            <ChatStatusRow
              icon={
                <span
                  aria-hidden
                  className={cn("size-2.5 rounded-[3px]", segment.colorClass)}
                />
              }
              key={segment.id}
              trailing={
                <span className="text-muted-foreground text-xs tabular-nums">
                  {formatTokenCountDetailed(segment.tokens)}
                </span>
              }
            >
              {segment.label}
            </ChatStatusRow>
          ))}
        </ChatStatusSection>
      ) : null}

      <ChatStatusSection title="Connectors">
        {servers.length === 0 ? (
          <li className="text-muted-foreground text-sm">
            {detail.isPending ? "Loading…" : "No MCP servers"}
          </li>
        ) : (
          servers.map((server) => (
            <ChatStatusRow
              icon={<Plug01Icon aria-hidden className="size-4" />}
              key={server.id}
              trailing={
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    server.enabled
                      ? (MCP_STATUS_DOT[server.status] ??
                          "bg-muted-foreground/40")
                      : "bg-muted-foreground/40"
                  )}
                  title={server.enabled ? server.status : "disabled"}
                />
              }
            >
              {server.name}
            </ChatStatusRow>
          ))
        )}
      </ChatStatusSection>

      <ChatStatusSection title="Outputs">
        {artifacts.length === 0 ? (
          <li className="text-muted-foreground text-sm">No files yet</li>
        ) : (
          artifacts.map((artifact) => (
            <ChatStatusArtifactRow
              artifact={artifact}
              key={`${artifact.ownerProfileId ?? ""}:${artifact.path}`}
              profileId={profileId}
            />
          ))
        )}
      </ChatStatusSection>
    </>
  );
}
