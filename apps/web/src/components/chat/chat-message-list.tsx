import {
  CheckmarkCircle01Icon,
  Copy01Icon,
  File01Icon,
  GitBranchIcon,
  MoreHorizontalIcon,
  Rotate02Icon,
} from "hugeicons-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Components, Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationStickinessProvider,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { ArtifactAttachmentPreview } from "@/components/chat/artifact-attachment-preview";
import { AssistantTurnSegmentView } from "@/components/chat/assistant-tool-group";
import { segmentAssistantTurn } from "@/components/chat/assistant-tool-group.shared";
import { ImageAttachmentPreview } from "@/components/chat/image-attachment-preview";
import { TextAttachmentPreview } from "@/components/chat/text-attachment-preview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { extractTurnArtifacts } from "@/lib/chat-artifacts";
import { type ChatListItem, formatSessionTimestamp } from "@/lib/chat-history";
import {
  followOutputBehavior,
  listOverflowsViewport,
  shouldAutoscrollOnHeightGrowth,
} from "@/lib/chat-list-stickiness";
import {
  groupMessagesIntoTurns,
  type IndexedMessage,
  type MessageTurn,
  turnKey,
} from "@/lib/chat-message-turns";
import { awaitingModelLabel, isAwaitingModelResponse } from "@/lib/chat-stream";
import { formatElapsedSeconds, useElapsedSeconds } from "@/lib/elapsed-time";
import { isPastedTextDocument } from "@/lib/pasted-text";
import { cn } from "@/lib/utils";

/** Top/bottom inset as Virtuoso Header/Footer — never put padding on the scroller. */
function VirtuosoEdgePad() {
  return <div aria-hidden className="h-4 shrink-0" />;
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
      className="shrink-0 overflow-visible"
      ref={ref}
      style={style}
    >
      {children}
    </div>
  );
});

const virtuosoComponents: Components<MessageTurn> = {
  Footer: VirtuosoEdgePad,
  Header: VirtuosoEdgePad,
  Item: VirtuosoItem,
};

interface ChatMessageListProps {
  actionsDisabled?: boolean;
  branchingMessageId?: string | null;
  className?: string;
  contentClassName?: string;
  emptyMessage?: string;
  messages: ChatListItem[];
  modelLabel?: string | null;
  onBranchMessage?: (message: ChatListItem) => void;
  onRetryMessage?: (message: ChatListItem) => void;
  profileId?: string | null;
  showThinking?: boolean;
  /** True while the assistant reply SSE stream is in flight. */
  streamActive?: boolean;
  turnStartedAt?: string | null;
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
      !(scroller && listOverflowsViewport(listHeight, scroller.clientHeight))
    ) {
      if (scroller) {
        scroller.scrollTop = 0;
      }
      return;
    }
    virtuosoRef.current?.scrollToIndex({
      align: "end",
      behavior,
      index: "LAST",
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
    [isAtBottom, scrollToLatest]
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
      !(
        scroller &&
        listOverflowsViewport(lastListHeightRef.current, scroller.clientHeight)
      )
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
    [pinLatest]
  );

  const renderTurn = useCallback(
    (turnIndex: number, turn: MessageTurn) => {
      // Horizontal inset lives on items — padding on the Virtuoso scroller can
      // clip absolutely positioned rows.
      const itemClassName = cn(
        "shrink-0 overflow-visible",
        contentClassName ?? "px-4",
        turnIndex === turns.length - 1 ? "pb-4" : "pb-6"
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
            actionsDisabled={actionsDisabled}
            branchingMessageId={branchingMessageId}
            messages={turn.messages}
            modelLabel={modelLabel}
            onBranchMessage={onBranchMessage}
            onRetryMessage={onRetryMessage}
            profileId={profileId}
            showAwaiting={
              turnIndex === turns.length - 1 && awaitingLabel === "Working…"
            }
            showThinking={showThinking}
            streamActive={streamActive}
            turnStartedAt={turnStartedAt}
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
    ]
  );

  if (turns.length === 0) {
    return (
      <ConversationStickinessProvider
        value={{ isAtBottom: true, scrollToLatest: () => undefined }}
      >
        <Conversation className={cn("min-h-0 flex-1", className)}>
          <ConversationContent
            className={cn("justify-start gap-6 px-4 py-4", contentClassName)}
          >
            {emptyMessage ? (
              <p className="text-muted-foreground text-sm">{emptyMessage}</p>
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
          atBottomStateChange={handleAtBottomStateChange}
          atBottomThreshold={80}
          className="no-scrollbar h-full"
          components={virtuosoComponents}
          computeItemKey={(_, turn) => turnKey(turn)}
          data={turns}
          followOutput={handleFollowOutput}
          increaseViewportBy={{ bottom: 200, top: 200 }}
          // Default is top-aligned for short lists. Do not set alignToBottom —
          // that uses marginTop:auto and packs messages to the bottom.
          // https://virtuoso.dev/react-virtuoso/api-reference/virtuoso/
          initialTopMostItemIndex={0}
          itemContent={renderTurn}
          ref={virtuosoRef}
          scrollerRef={(ref) => {
            scrollerRef.current = ref instanceof HTMLElement ? ref : null;
          }}
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
    <div className="group mr-auto ml-0 flex w-full max-w-full flex-col items-start justify-start gap-3">
      {segments.map((segment) => (
        <AssistantTurnSegmentView
          key={
            segment.kind === "work"
              ? `work:${segment.thinking?.id ?? "thought"}:${segment.tools.map((message) => message.id).join(":")}`
              : `text:${segment.message.id}`
          }
          modelLabel={modelLabel}
          segment={segment}
          showThinking={showThinking}
        />
      ))}
      {showAwaiting ? <TurnAwaitingElapsed startedAt={turnStartedAt} /> : null}
      {profileId && showArtifacts ? (
        <div className="flex flex-wrap gap-2">
          {artifacts.map((artifact) => {
            const chipId = `${artifactTurnKey}:${artifact.path}`;

            return (
              <ArtifactAttachmentPreview
                artifact={artifact}
                id={chipId}
                key={chipId}
                profileId={profileId}
              />
            );
          })}
        </div>
      ) : null}
      {showActions && anchorMessage ? (
        <AssistantMessageActions
          actionsDisabled={actionsDisabled}
          busy={branchingMessageId === anchorMessage.id}
          copyContent={assistantTurnContent(turnMessages)}
          message={anchorMessage}
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
      aria-live="polite"
      className="text-muted-foreground text-xs tabular-nums"
      role="status"
    >
      {formatElapsedSeconds(elapsedSeconds)}
    </span>
  );
}

function ChatMessageRow({ message }: { message: ChatListItem }) {
  return (
    <Message
      className="mr-0 ml-auto min-w-0 max-w-full items-end justify-end overflow-visible"
      from="user"
    >
      <MessageContent className="ml-auto min-w-0 max-w-full overflow-visible group-[.is-user]:ml-auto">
        <UserMessageContent message={message} />
      </MessageContent>
    </Message>
  );
}

function isAssistantTurnComplete(messages: ChatListItem[]): boolean {
  return (
    messages.some(
      (message) => message.role === "assistant" && !message.streaming
    ) &&
    !messages.some(
      (message) =>
        (message.role === "assistant" && message.streaming) ||
        (message.role === "tool" && message.toolStatus === "running")
    )
  );
}

function findAssistantTurnAnchor(
  messages: ChatListItem[]
): ChatListItem | null {
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

  useEffect(
    () => () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    },
    []
  );

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

  const branchCreatedAt = isBranchableAssistantMessage(message)
    ? message.createdAt
    : null;

  return (
    <div className="flex items-center gap-1 pt-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
      <button
        aria-label={copied ? "Copied" : "Copy response"}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40",
          copied && "text-emerald-600 dark:text-emerald-400"
        )}
        disabled={!copyContent.trim()}
        onClick={() => void copyMessage()}
        title={copied ? "Copied" : "Copy response"}
        type="button"
      >
        {copied ? (
          <CheckmarkCircle01Icon aria-hidden className="size-4" />
        ) : (
          <Copy01Icon aria-hidden className="size-4" />
        )}
      </button>
      {onRetryMessage ? (
        <button
          aria-label="Try again"
          className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
          disabled={busy || actionsDisabled}
          onClick={() => onRetryMessage(message)}
          title="Try again"
          type="button"
        >
          <Rotate02Icon aria-hidden className="size-4" />
        </button>
      ) : null}
      {onBranchMessage && branchCreatedAt ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                aria-label="Message actions"
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  busy && "pointer-events-none opacity-60"
                )}
                type="button"
              />
            }
          >
            <MoreHorizontalIcon aria-hidden className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 min-w-56 p-1.5">
            <div className="px-2 py-1 text-muted-foreground text-xs">
              {formatSessionTimestamp(branchCreatedAt)}
            </div>
            <DropdownMenuItem
              className="gap-2"
              disabled={busy}
              onClick={() => onBranchMessage(message)}
            >
              <GitBranchIcon aria-hidden className="size-4" />
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
        <p className="mb-2 font-medium text-muted-foreground text-sm">
          Answers
        </p>
        <div className="space-y-3">
          {message.questionnaireAnswers.map((entry) => (
            <div
              className="space-y-1"
              key={`${entry.questionId}:${entry.prompt}`}
            >
              <p className="whitespace-pre-wrap text-foreground">
                {entry.prompt}
              </p>
              <p className="whitespace-pre-wrap text-muted-foreground text-sm">
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
      isPastedTextDocument(document.filename, document.mediaType)
    ) ?? [];
  const otherDocuments =
    message.documents?.filter(
      (document) => !isPastedTextDocument(document.filename, document.mediaType)
    ) ?? [];

  return (
    <div className="space-y-2">
      {message.imageAttachments?.length ? (
        <div className="flex flex-wrap gap-2">
          {message.imageAttachments.map((image) => (
            <ImageAttachmentPreview
              description={image.description}
              key={
                image.url ??
                `image-attachment-${message.id}-${image.description ?? "unnamed"}`
              }
              url={image.url}
            />
          ))}
        </div>
      ) : null}
      {message.images?.length ? (
        <div className="flex flex-wrap gap-2">
          {message.images.map((image) => (
            <img
              alt=""
              className="max-h-40 max-w-full rounded-md border border-border object-contain"
              key={image.url}
              src={image.url}
            />
          ))}
        </div>
      ) : null}
      {pastedTextDocuments.length ? (
        <div className="flex flex-wrap gap-2">
          {pastedTextDocuments.map((document) => (
            <TextAttachmentPreview
              filename={document.filename}
              key={`${document.filename}-${document.mediaType}`}
            />
          ))}
        </div>
      ) : null}
      {otherDocuments.length ? (
        <div className="flex flex-wrap gap-2">
          {otherDocuments.map((document) => (
            <div
              className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-muted px-3 py-2"
              key={`${document.filename}-${document.mediaType}`}
            >
              <File01Icon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="truncate text-foreground text-sm">
                {document.filename}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {message.content ? (
        <p className="whitespace-pre-wrap break-words text-foreground">
          {message.content}
        </p>
      ) : null}
    </div>
  );
}
