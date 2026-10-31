import type {
  AgentChannel,
  McpServerSummary,
  ProfileSummary,
} from "@nakama/core/contract";
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
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { groupMessagesIntoTurns } from "@/lib/chat-message-turns";

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

function mcpStatusDotClass(server: McpServerSummary) {
  if (!server.enabled) {
    return "bg-muted-foreground/40";
  }

  if (server.status === "connected") {
    return "bg-emerald-500";
  }

  return server.status === "error"
    ? "bg-destructive"
    : "bg-muted-foreground/40";
}

/** Chat state the status panel shows. */
export interface ChatStatusData {
  busy: boolean;
  channel: AgentChannel;
  contextUsage: ChatContextUsage | null;
  messages: ChatListItem[];
  modelLabel: ReactNode;
  profile: ProfileSummary | undefined;
  profileId: string;
}

interface ChatStatusSelection {
  artifact: ChatArtifactRef;
  /** Bumped on every click, so a second click on the same file opens it again. */
  nonce: number;
}

interface ChatStatusContextValue {
  clear: () => void;
  data: ChatStatusData;
  select: (artifact: ChatArtifactRef) => void;
  selection: ChatStatusSelection | null;
}

const ChatStatusContext = createContext<ChatStatusContextValue | null>(null);

function useChatStatus(): ChatStatusContextValue {
  const context = useContext(ChatStatusContext);

  if (!context) {
    throw new Error("useChatStatus must be used within ChatStatusProvider");
  }

  return context;
}

/**
 * Gives the status panel live chat state. It wraps the attachment panel
 * provider, so the panel body reads it directly instead of being re-sent.
 */
export function ChatStatusProvider({
  children,
  data,
}: {
  children: ReactNode;
  data: ChatStatusData;
}) {
  const [selection, setSelection] = useState<ChatStatusSelection | null>(null);
  const clear = useCallback(() => setSelection(null), []);

  const select = useCallback(
    (artifact: ChatArtifactRef) =>
      setSelection((current) => ({
        artifact,
        nonce: (current?.nonce ?? 0) + 1,
      })),
    []
  );

  const value = useMemo(
    () => ({ clear, data, select, selection }),
    [clear, data, select, selection]
  );

  return (
    <ChatStatusContext.Provider value={value}>
      {children}
    </ChatStatusContext.Provider>
  );
}

function artifactKey(artifact: ChatArtifactRef) {
  return `${artifact.ownerProfileId ?? ""}:${artifact.path}`;
}

/** Newest first, one entry per file, read turn by turn like the transcript. */
function collectArtifacts(messages: ChatListItem[]) {
  const byKey = new Map<string, ChatArtifactRef>();

  for (const turn of groupMessagesIntoTurns(messages).reverse()) {
    if (turn.kind === "user") {
      continue;
    }

    const turnArtifacts = extractTurnArtifacts(
      turn.messages.map(({ message }) => message)
    );

    for (const artifact of turnArtifacts.reverse()) {
      const key = artifactKey(artifact);

      if (!byKey.has(key)) {
        byKey.set(key, artifact);
      }
    }
  }

  return [...byKey.values()];
}

/**
 * Owns the preview of a file picked in Outputs. It lives beside the chat, not
 * in the status panel, so it stays mounted (and keeps loading the file) after
 * the preview replaces the status panel.
 */
export function ChatStatusArtifactOpener() {
  const { clear, data, selection } = useChatStatus();

  if (!selection) {
    return null;
  }

  return (
    <ChatStatusArtifactPreview
      artifact={selection.artifact}
      key={`${artifactKey(selection.artifact)}:${selection.nonce}`}
      onClosed={clear}
      profileId={data.profileId}
    />
  );
}

function ChatStatusArtifactPreview({
  artifact,
  onClosed,
  profileId,
}: {
  artifact: ChatArtifactRef;
  onClosed: () => void;
  profileId: string;
}) {
  const { activeId } = useChatAttachmentPanel();
  const id = `chat-status:${artifactKey(artifact)}`;
  const requestedRef = useRef(false);
  const shownRef = useRef(false);

  const { openPanel } = useArtifactAttachmentPreviewPanel({
    artifact,
    id,
    profileId: artifact.ownerProfileId ?? profileId,
  });

  useEffect(() => {
    if (!requestedRef.current) {
      requestedRef.current = true;
      openPanel();
    }
  });

  // Unmount once the preview is closed or replaced.
  useEffect(() => {
    if (activeId === id) {
      shownRef.current = true;
    } else if (shownRef.current) {
      onClosed();
    }
  }, [activeId, id, onClosed]);

  return null;
}

function ChatStatusArtifactRow({ artifact }: { artifact: ChatArtifactRef }) {
  const { select } = useChatStatus();
  const type = artifact.filename.split(".").pop()?.toUpperCase();

  return (
    <li>
      <button
        className="-mx-1.5 flex min-h-7 w-[calc(100%+0.75rem)] items-center gap-2.5 rounded-md px-1.5 text-left text-sm hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => select(artifact)}
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

const CHAT_STATUS_PANEL_ID = "chat-status";

/**
 * Opens the chat status in the right side panel: agent, model and channel,
 * context use, MCP servers and files the agent made.
 */
export function ChatStatusButton() {
  const { activeId, hide, show } = useChatAttachmentPanel();
  const open = activeId === CHAT_STATUS_PANEL_ID;

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
              content: <ChatStatusBody />,
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

function ChatStatusBody() {
  const {
    data: {
      busy,
      channel,
      contextUsage,
      messages,
      modelLabel,
      profile,
      profileId,
    },
  } = useChatStatus();

  const detail = useProfileQuery(profileId);
  const servers = detail.data?.mcpServers ?? [];
  // Files are listed from finished turns only, so a streaming reply does not
  // re-scan the whole chat on every token.
  const [settledMessages, setSettledMessages] = useState(messages);

  useEffect(() => {
    if (!busy) {
      setSettledMessages(messages);
    }
  }, [busy, messages]);

  const artifacts = useMemo(
    () => collectArtifacts(settledMessages),
    [settledMessages]
  );

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
                    mcpStatusDotClass(server)
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
              key={artifactKey(artifact)}
            />
          ))
        )}
      </ChatStatusSection>
    </>
  );
}
