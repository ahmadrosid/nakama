import { useCallback, useEffect, useMemo, useRef, useState, forwardRef } from "react";
import {
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  GitBranchIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
} from "lucide-react";
import {
  Virtuoso,
  type Components,
  type VirtuosoHandle,
} from "react-virtuoso";
import {
  AssistantTurnSegmentView,
} from "@/components/chat/assistant-tool-group";
import { segmentAssistantTurn } from "@/components/chat/assistant-tool-group.shared";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationStickinessProvider,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
} from "@/components/ai-elements/message";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatSessionTimestamp, type ChatListItem } from "@/lib/chat-history";
import {
  awaitingModelLabel,
  isAwaitingModelResponse,
} from "@/lib/chat-stream";
import {
  followOutputBehavior,
  listOverflowsViewport,
  shouldAutoscrollOnHeightGrowth,
} from "@/lib/chat-list-stickiness";
import { formatElapsedSeconds, useElapsedSeconds } from "@/lib/elapsed-time";
import { isPastedTextDocument } from "@/lib/pasted-text";
import { TextAttachmentPreview } from "@/components/chat/text-attachment-preview";
import { ImageAttachmentPreview } from "@/components/chat/image-attachment-preview";
import { ArtifactAttachmentPreview } from "@/components/chat/artifact-attachment-preview";
import { extractTurnArtifacts } from "@/lib/chat-artifacts";
import {
  groupMessagesIntoTurns,
  turnKey,
  type IndexedMessage,
  type MessageTurn,
} from "@/lib/chat-message-turns";
import { cn } from "@/lib/utils";

/** Top/bottom inset as Virtuoso Header/Footer — never put padding on the scroller. */
function VirtuosoEdgePad() {
  return <div className="h-4 shrink-0" aria-hidden />;
}

/**
 * Keep Virtuoso rows from shrinking if the list uses a flex viewport.
 * overflow-visible so bubbles aren't clipped by the item wrapper.
 */
const VirtuosoItem = forwardRef<
  HTMLDivElement,
  {
    children?: React.ReactNode;
    style?: React.CSSProperties;
    "data-index": number;
    "data-item-index": number;
    "data-known-size": number;
    item: MessageTurn;
  }
>(function VirtuosoItem({ children, style, ...props }, ref) {
  return (
    <div
      {...props}
      ref={ref}
      style={style}
      className="shrink-0 overflow-visible"
    >
      {children}
    </div>
  );
});

const virtuosoComponents: Components<MessageTurn> = {
  Header: VirtuosoEdgePad,
  Footer: VirtuosoEdgePad,
  Item: VirtuosoItem,
};

interface ChatMessageListProps {
  messages: ChatListItem[];
  profileId?: string | null;
  showThinking?: boolean;
  modelLabel?: string | null;
  branchingMessageId?: string | null;
  actionsDisabled?: boolean;
  /** True while the assistant reply SSE stream is in flight. */
  streamActive?: boolean;
  turnStartedAt?: string | null;
  onBranchMessage?: (message: ChatListItem) => void;
  onRetryMessage?: (message: ChatListItem) => void;
  emptyMessage?: string;
  className?: string;
  contentClassName?: string;
}

export function ChatMessageList(props: ChatMessageListProps) {
  const sessionAnchor = props.messages[0]?.id ?? "empty";
  return <ChatMessageListSession key={sessionAnchor} {...props} />;
}

function ChatMessageListSession({
  messages,
  profileId,
  showThinking = true,
  modelLabel,
  branchingMessageId,
  actionsDisabled = false,
  streamActive = false,
  turnStartedAt = null,
  onBranchMessage,
  onRetryMessage,
  emptyMessage,
  className,
  contentClassName,
}: ChatMessageListProps) {
  const turns = useMemo(() => groupMessagesIntoTurns(messages), [messages]);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const isAtBottomRef = useRef(true);
  const stickIntentRef = useRef(true);
  const lastListHeightRef = useRef(0);
  const didInitialPinRef = useRef(false);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const showAwaitingPlaceholder =
    streamActive && isAwaitingModelResponse(messages);
  const awaitingLabel = showAwaitingPlaceholder
    ? awaitingModelLabel(messages)
    : null;

  const pinLatest = useCallback((behavior: "auto" | "smooth") => {
    const scroller = scrollerRef.current;
    const listHeight = lastListHeightRef.current;
    // Per Virtuoso docs: omit alignToBottom for top packing. Never use
    // scrollToIndex({ align: "end" }) when content still fits the viewport —
    // that is what packs short threads to the bottom.
    if (
      !scroller ||
      !listOverflowsViewport(listHeight, scroller.clientHeight)
    ) {
      if (scroller) scroller.scrollTop = 0;
      return;
    }
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior,
    });
  }, []);

  const scrollToLatest = useCallback(() => {
    stickIntentRef.current = true;
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    pinLatest("smooth");
  }, [pinLatest]);

  const stickiness = useMemo(
    () => ({
      isAtBottom,
      scrollToLatest,
    }),
    [isAtBottom, scrollToLatest],
  );

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    stickIntentRef.current = atBottom;
  }, []);

  // followOutput is Virtuoso's documented append follower. It scrolls with
  // align-end semantics, so skip it while the list still fits the viewport.
  const handleFollowOutput = useCallback((_atBottom: boolean) => {
    const scroller = scrollerRef.current;
    if (
      !scroller ||
      !listOverflowsViewport(lastListHeightRef.current, scroller.clientHeight)
    ) {
      return false;
    }
    return followOutputBehavior(stickIntentRef.current);
  }, []);

  // followOutput does not watch existing-item resize (streaming tokens).
  // Re-pin manually only when overflowing — see Virtuoso issue #195.
  const handleTotalListHeightChanged = useCallback(
    (height: number) => {
      const previous = lastListHeightRef.current;
      lastListHeightRef.current = height;

      if (!didInitialPinRef.current) {
        didInitialPinRef.current = true;
        pinLatest("auto");
        return;
      }

      if (
        height > previous &&
        shouldAutoscrollOnHeightGrowth(stickIntentRef.current)
      ) {
        pinLatest("auto");
      }
    },
    [pinLatest],
  );

  const renderTurn = useCallback(
    (turnIndex: number, turn: MessageTurn) => {
      // Horizontal inset lives on items — padding on the Virtuoso scroller can
      // clip absolutely positioned rows.
      const itemClassName = cn(
        "shrink-0 overflow-visible",
        contentClassName ?? "px-4",
        turnIndex === turns.length - 1 ? "pb-4" : "pb-6",
      );

      if (turn.kind === "user") {
        return (
          <div className={itemClassName}>
            <ChatMessageRow message={turn.message} />
          </div>
        );
      }

      return (
        <div className={itemClassName}>
          <AssistantTurn
            messages={turn.messages}
            profileId={profileId}
            showThinking={showThinking}
            modelLabel={modelLabel}
            branchingMessageId={branchingMessageId}
            actionsDisabled={actionsDisabled}
            streamActive={streamActive}
            showAwaiting={
              turnIndex === turns.length - 1 && awaitingLabel === "Working…"
            }
            turnStartedAt={turnStartedAt}
            onBranchMessage={onBranchMessage}
            onRetryMessage={onRetryMessage}
          />
        </div>
      );
    },
    [
      actionsDisabled,
      awaitingLabel,
      branchingMessageId,
      contentClassName,
      modelLabel,
      onBranchMessage,
      onRetryMessage,
      profileId,
      showThinking,
      streamActive,
      turnStartedAt,
      turns.length,
    ],
  );

  if (turns.length === 0) {
    return (
      <ConversationStickinessProvider
        value={{ isAtBottom: true, scrollToLatest: () => undefined }}
      >
        <Conversation className={cn("min-h-0 flex-1", className)}>
          <ConversationContent
            className={cn(
              "justify-start gap-6 px-4 py-4",
              contentClassName,
            )}
          >
            {emptyMessage ? (
              <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            ) : null}
          </ConversationContent>
        </Conversation>
      </ConversationStickinessProvider>
    );
  }

  return (
    <ConversationStickinessProvider value={stickiness}>
      <Conversation className={cn("min-h-0 flex-1", className)}>
        <Virtuoso
          ref={virtuosoRef}
          className="h-full no-scrollbar"
          data={turns}
          components={virtuosoComponents}
          computeItemKey={(_, turn) => turnKey(turn)}
          itemContent={renderTurn}
          // Default is top-aligned for short lists. Do not set alignToBottom —
          // that uses marginTop:auto and packs messages to the bottom.
          // https://virtuoso.dev/react-virtuoso/api-reference/virtuoso/
          initialTopMostItemIndex={0}
          scrollerRef={(ref) => {
            scrollerRef.current =
              ref instanceof HTMLElement ? ref : null;
          }}
          followOutput={handleFollowOutput}
          atBottomStateChange={handleAtBottomStateChange}
          atBottomThreshold={80}
          increaseViewportBy={{ top: 200, bottom: 200 }}
          totalListHeightChanged={handleTotalListHeightChanged}
        />
        <ConversationScrollButton />
      </Conversation>
    </ConversationStickinessProvider>
  );
}

function AssistantTurn({
  messages,
  profileId,
  showThinking,
  modelLabel,
  branchingMessageId,
  actionsDisabled,
  streamActive,
  showAwaiting,
  turnStartedAt,
  onBranchMessage,
  onRetryMessage,
}: {
  messages: IndexedMessage[];
  profileId?: string | null;
  showThinking: boolean;
  modelLabel?: string | null;
  branchingMessageId?: string | null;
  actionsDisabled?: boolean;
  streamActive: boolean;
  showAwaiting?: boolean;
  turnStartedAt?: string | null;
  onBranchMessage?: (message: ChatListItem) => void;
  onRetryMessage?: (message: ChatListItem) => void;
}) {
  const turnMessages = messages.map(({ message }) => message);
  const segments = segmentAssistantTurn(turnMessages);
  const artifacts = extractTurnArtifacts(turnMessages);
  const artifactTurnKey = messages.map(({ message }) => message.id).join(":");
  const anchorMessage = findAssistantTurnAnchor(turnMessages);
  const turnComplete = isAssistantTurnComplete(turnMessages);
  // Wait for the full SSE reply (tools + final summary), not the brief gap after tool_end.
  const showArtifacts = turnComplete && artifacts.length > 0;
  const showActions = !streamActive && turnComplete && anchorMessage != null;

  return (
    <div className="group flex w-full max-w-full flex-col gap-3 mr-auto ml-0 items-start justify-start">
      {segments.map((segment) => (
        <AssistantTurnSegmentView
          key={
            segment.kind === "work"
              ? `work:${segment.thinking?.id ?? "thought"}:${segment.tools.map((message) => message.id).join(":")}`
              : `text:${segment.message.id}`
          }
          segment={segment}
          showThinking={showThinking}
          modelLabel={modelLabel}
        />
      ))}
      {showAwaiting ? (
        <TurnAwaitingElapsed startedAt={turnStartedAt} />
      ) : null}
      {profileId && showArtifacts ? (
        <div className="flex flex-wrap gap-2">
          {artifacts.map((artifact) => {
            const chipId = `${artifactTurnKey}:${artifact.path}`;

            return (
              <ArtifactAttachmentPreview
                key={chipId}
                id={chipId}
                profileId={profileId}
                artifact={artifact}
              />
            );
          })}
        </div>
      ) : null}
      {showActions && anchorMessage ? (
        <AssistantMessageActions
          message={anchorMessage}
          copyContent={assistantTurnContent(turnMessages)}
          busy={branchingMessageId === anchorMessage.id}
          actionsDisabled={actionsDisabled}
          onBranchMessage={onBranchMessage}
          onRetryMessage={onRetryMessage}
        />
      ) : null}
    </div>
  );
}

function TurnAwaitingElapsed({ startedAt }: { startedAt?: string | null }) {
  const elapsedSeconds = useElapsedSeconds(true, startedAt ?? undefined);

  return (
    <span
      role="status"
      aria-live="polite"
      className="text-xs tabular-nums text-muted-foreground"
    >
      {formatElapsedSeconds(elapsedSeconds)}
    </span>
  );
}

function ChatMessageRow({ message }: { message: ChatListItem }) {
  return (
    <Message
      from="user"
      className="max-w-full ml-auto mr-0 min-w-0 items-end justify-end overflow-visible"
    >
      <MessageContent className="max-w-full min-w-0 ml-auto overflow-visible group-[.is-user]:ml-auto">
        <UserMessageContent message={message} />
      </MessageContent>
    </Message>
  );
}

function isAssistantTurnComplete(messages: ChatListItem[]): boolean {
  return (
    messages.some((message) => message.role === "assistant" && !message.streaming) &&
    !messages.some(
      (message) =>
        (message.role === "assistant" && message.streaming) ||
        (message.role === "tool" && message.toolStatus === "running"),
    )
  );
}

function findAssistantTurnAnchor(messages: ChatListItem[]): ChatListItem | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === "assistant" && !message.streaming) {
      return message;
    }
  }

  return null;
}

function assistantTurnContent(messages: ChatListItem[]): string {
  const parts: string[] = [];

  for (const message of messages) {
    if (message.role === "assistant" && message.content.trim()) {
      parts.push(message.content.trim());
    }
  }

  return parts.join("\n\n");
}

function isBranchableAssistantMessage(message: ChatListItem): boolean {
  return (
    message.role === "assistant" &&
    !message.streaming &&
    typeof message.historyIndex === "number" &&
    Boolean(message.createdAt)
  );
}

function AssistantMessageActions({
  message,
  copyContent,
  busy,
  actionsDisabled = false,
  onBranchMessage,
  onRetryMessage,
}: {
  message: ChatListItem;
  copyContent: string;
  busy: boolean;
  actionsDisabled?: boolean;
  onBranchMessage?: (message: ChatListItem) => void;
  onRetryMessage?: (message: ChatListItem) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  async function copyMessage() {
    const content = copyContent.trim();

    if (!content) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch {
      // Clipboard may be unavailable outside secure contexts.
    }
  }

  const branchCreatedAt = isBranchableAssistantMessage(message) ? message.createdAt : null;

  return (
    <div className="flex items-center gap-1 pt-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <button
        type="button"
        aria-label={copied ? "Copied" : "Copy response"}
        title={copied ? "Copied" : "Copy response"}
        disabled={!copyContent.trim()}
        onClick={() => void copyMessage()}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40",
          copied && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {copied ? (
          <CheckIcon className="size-4" aria-hidden />
        ) : (
          <CopyIcon className="size-4" aria-hidden />
        )}
      </button>
      {onRetryMessage ? (
        <button
          type="button"
          aria-label="Try again"
          title="Try again"
          disabled={busy || actionsDisabled}
          onClick={() => onRetryMessage(message)}
          className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
        >
          <RotateCcwIcon className="size-4" aria-hidden />
        </button>
      ) : null}
      {onBranchMessage && branchCreatedAt ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="Message actions"
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  busy && "pointer-events-none opacity-60",
                )}
              />
            }
          >
            <MoreHorizontalIcon className="size-4" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 min-w-56 p-1.5">
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {formatSessionTimestamp(branchCreatedAt)}
            </div>
            <DropdownMenuItem
              disabled={busy}
              onClick={() => onBranchMessage(message)}
              className="gap-2"
            >
              <GitBranchIcon className="size-4" aria-hidden />
              <span>Branch in new chat</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function UserMessageContent({ message }: { message: ChatListItem }) {
  if (message.questionnaireAnswers?.length) {
    return (
      <div className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3">
        <p className="mb-2 text-sm font-medium text-muted-foreground">Answers</p>
        <div className="space-y-3">
          {message.questionnaireAnswers.map((entry) => (
            <div key={`${entry.questionId}:${entry.prompt}`} className="space-y-1">
              <p className="whitespace-pre-wrap text-foreground">{entry.prompt}</p>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {entry.answer}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const pastedTextDocuments =
    message.documents?.filter((document) =>
      isPastedTextDocument(document.filename, document.mediaType),
    ) ?? [];
  const otherDocuments =
    message.documents?.filter(
      (document) => !isPastedTextDocument(document.filename, document.mediaType),
    ) ?? [];

  return (
    <div className="space-y-2">
      {message.imageAttachments?.length ? (
        <div className="flex flex-wrap gap-2">
          {message.imageAttachments.map((image) => (
            <ImageAttachmentPreview
              key={image.url ?? `image-attachment-${message.id}-${image.description ?? "unnamed"}`}
              url={image.url}
              description={image.description}
            />
          ))}
        </div>
      ) : null}
      {message.images?.length ? (
        <div className="flex flex-wrap gap-2">
          {message.images.map((image) => (
            <img
              key={image.url}
              src={image.url}
              alt=""
              className="max-h-40 max-w-full rounded-md border border-border object-contain"
            />
          ))}
        </div>
      ) : null}
      {pastedTextDocuments.length ? (
        <div className="flex flex-wrap gap-2">
          {pastedTextDocuments.map((document) => (
            <TextAttachmentPreview
              key={`${document.filename}-${document.mediaType}`}
              filename={document.filename}
            />
          ))}
        </div>
      ) : null}
      {otherDocuments.length ? (
        <div className="flex flex-wrap gap-2">
          {otherDocuments.map((document) => (
            <div
              key={`${document.filename}-${document.mediaType}`}
              className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-muted px-3 py-2"
            >
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate text-sm text-foreground">{document.filename}</span>
            </div>
          ))}
        </div>
      ) : null}
      {message.content ? (
        <p className="whitespace-pre-wrap break-words text-foreground">{message.content}</p>
      ) : null}
    </div>
  );
}
