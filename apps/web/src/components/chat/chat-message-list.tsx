import { hasActiveAgentQuestionnaire } from "@nakama/core/agent-questionnaire";
import type {
  AgentQuestionAnswer,
  AgentQuestionnaire,
  ChatUsage,
  ListComposioToolkitsResponse,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { Textarea } from "@nakama/ui/textarea";
import { cn } from "@nakama/ui/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckmarkCircle01Icon,
  Copy01Icon,
  Edit03Icon,
  GitBranchIcon,
  MoreHorizontalIcon,
  Rotate02Icon,
} from "hugeicons-react";
import {
  forwardRef,
  type MouseEvent,
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
import { ComposioToolkitLogo } from "@/components/ComposioToolkitLogo";
import {
  AgentQuestionnaireAnswers,
  AgentQuestionnairePanel,
} from "@/components/chat/AgentQuestionnairePanel";
import { ArtifactAttachmentPreview } from "@/components/chat/artifact-attachment-preview";
import {
  AssistantTurnSegmentView,
  GroupCreatedCard,
  LocalCitationPreview,
  ProfileCreatedCard,
} from "@/components/chat/assistant-tool-group";
import { segmentAssistantTurn } from "@/components/chat/assistant-tool-group.shared";
import { ToolCredentialCard } from "@/components/chat/chat-add-capabilities-dialogs";
import { ChatUsageBadge } from "@/components/chat/chat-usage-badge";
import { DocumentAttachmentPreview } from "@/components/chat/document-attachment-preview";
import { ImageAttachmentPreview } from "@/components/chat/image-attachment-preview";
import { PluginDrafts } from "@/components/chat/PluginDraftCard";
import { TextAttachmentPreview } from "@/components/chat/text-attachment-preview";
import { readRecord, readString } from "@/components/chat/web-search.shared";
import { useAuth } from "@/context/use-auth";
import { useOptionalChatAttachmentPanel } from "@/context/use-chat-attachment-panel";
import { useProfileQuery } from "@/hooks/use-app-queries";
import {
  connectComposioApp,
  profileComposioToolkitsQueryOptions,
  useComposioToolkits,
} from "@/hooks/use-composio";
import { useArtifactsExist } from "@/hooks/use-resource-mutations";
import { extractTurnArtifacts } from "@/lib/chat-artifacts";
import {
  type ChatListItem,
  formatSessionTimestamp,
  isEditableUserMessage,
} from "@/lib/chat-history";
import {
  groupMessagesIntoTurns,
  type IndexedMessage,
  type MessageTurn,
  turnKey,
} from "@/lib/chat-message-turns";
import {
  awaitingModelLabel,
  isAwaitingModelResponse,
  parseGroupCreatedResult,
  parseProfileCreatedResult,
} from "@/lib/chat-stream";
import { sumChatUsage } from "@/lib/chat-usage";
import { formatError } from "@/lib/client";
import { formatElapsedSeconds, useElapsedSeconds } from "@/lib/elapsed-time";
import { isPastedTextDocument } from "@/lib/pasted-text";
import { canManageAgent } from "@/lib/profiles";
import { invalidateQueries } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";
import { listOverflowsViewport } from "./chat-message-list.shared";

function followOutputBehavior(atBottom: boolean): false | "auto" {
  return atBottom ? "auto" : false;
}

function shouldAutoscrollOnHeightGrowth(atBottom: boolean): boolean {
  return atBottom;
}

/** Growth right after a button click is the user expanding something: let it grow down, don't re-pin. */
const USER_TOGGLE_PIN_PAUSE_MS = 600;

function useUserTogglePinPause() {
  const userToggleAtRef = useRef(0);

  const onClickCapture = useCallback((event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest("button")) {
      userToggleAtRef.current = performance.now();
    }
  }, []);

  const isPinPaused = useCallback(
    () =>
      performance.now() - userToggleAtRef.current <= USER_TOGGLE_PIN_PAUSE_MS,
    []
  );

  return { isPinPaused, onClickCapture };
}

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
  onContinueToolSetup?: (setupId: string) => Promise<void>;
  onEditMessage?: (message: ChatListItem, text: string) => void;
  onRetryMessage?: (message: ChatListItem) => void;
  onSubmitQuestionnaire?: (answers: AgentQuestionAnswer[]) => void;
  profileId?: string | null;
  questionnaire?: AgentQuestionnaire | null;
  readOnly?: boolean;
  sessionId?: string;
  showThinking?: boolean;
  /** Show tokens and estimated cost under each completed assistant turn. */
  showUsage?: boolean;
  /** True while the assistant reply SSE stream is in flight. */
  streamActive?: boolean;
  turnStartedAt?: string | null;
  workStreamActive?: boolean;
}

export function ChatMessageList(props: ChatMessageListProps) {
  const sessionAnchor = props.sessionId ?? props.messages[0]?.id ?? "empty";

  return <ChatMessageListSession key={sessionAnchor} {...props} />;
}

function useListPinning() {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const isAtBottomRef = useRef(true);
  const stickIntentRef = useRef(true);
  const lastListHeightRef = useRef(0);
  const didInitialPinRef = useRef(false);
  const userTogglePinPause = useUserTogglePinPause();
  const { isPinPaused } = userTogglePinPause;
  const [isAtBottom, setIsAtBottom] = useState(true);

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

  const handleScrollerRef = useCallback((ref: HTMLElement | Window | null) => {
    scrollerRef.current = ref instanceof HTMLElement ? ref : null;
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
        shouldAutoscrollOnHeightGrowth(stickIntentRef.current) &&
        !isPinPaused()
      ) {
        pinLatest("auto");
      }
    },
    [isPinPaused, pinLatest]
  );

  return {
    handleAtBottomStateChange,
    handleFollowOutput,
    handleScrollerRef,
    handleTotalListHeightChanged,
    stickiness,
    userTogglePinPause,
    virtuosoRef,
  };
}

function ChatMessageListSession({
  sessionId,
  onContinueToolSetup,
  messages,
  profileId,
  showThinking = true,
  showUsage = false,
  modelLabel,
  branchingMessageId,
  actionsDisabled = false,
  readOnly = false,
  streamActive = false,
  turnStartedAt = null,
  workStreamActive = streamActive,
  onBranchMessage,
  onEditMessage,
  onRetryMessage,
  onSubmitQuestionnaire,
  questionnaire,
  emptyMessage,
  className,
  contentClassName,
}: ChatMessageListProps) {
  const turns = useMemo(() => groupMessagesIntoTurns(messages), [messages]);

  // A plugin draft card marks "Try it" once its tool runs anywhere in the chat.
  const usedPluginToolKey = [
    ...new Set(
      messages.flatMap((item) =>
        item.tool?.startsWith("plugin_") ? [item.tool] : []
      )
    ),
  ].join("\n");

  const usedPluginTools = useMemo(
    () => (usedPluginToolKey ? usedPluginToolKey.split("\n") : []),
    [usedPluginToolKey]
  );

  const {
    handleAtBottomStateChange,
    handleFollowOutput,
    handleScrollerRef,
    handleTotalListHeightChanged,
    stickiness,
    userTogglePinPause,
    virtuosoRef,
  } = useListPinning();

  const canPreviewCitations = useOptionalChatAttachmentPanel() !== null;

  const [citationPreview, setCitationPreview] = useState<{
    path: string;
    profileId: string;
  } | null>(null);

  const openCitationPreview = useCallback(
    (path: string) => {
      if (profileId) {
        setCitationPreview({ path, profileId });
      }
    },
    [profileId]
  );

  const closeCitationPreview = useCallback(() => setCitationPreview(null), []);

  const showAwaitingPlaceholder =
    streamActive && isAwaitingModelResponse(messages);

  const awaitingLabel = showAwaitingPlaceholder
    ? awaitingModelLabel(messages)
    : null;

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
            <ChatMessageRow
              busy={branchingMessageId != null || streamActive}
              disabled={actionsDisabled}
              message={turn.message}
              onEditMessage={onEditMessage}
            />
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
            onContinueToolSetup={onContinueToolSetup}
            onOpenFileCitation={
              canPreviewCitations ? openCitationPreview : undefined
            }
            onRetryMessage={onRetryMessage}
            onSubmitQuestionnaire={onSubmitQuestionnaire}
            profileId={profileId}
            questionnaire={
              turnIndex === turns.length - 1 ? questionnaire : null
            }
            questionnaireAnswers={turn.questionnaireAnswers}
            readOnly={readOnly}
            sessionId={sessionId}
            showAwaiting={
              turnIndex === turns.length - 1 && awaitingLabel === "Working…"
            }
            showThinking={showThinking}
            showUsage={showUsage}
            streamActive={streamActive}
            turnStartedAt={turnStartedAt}
            usedPluginTools={usedPluginTools}
            workStreamActive={
              workStreamActive && turnIndex === turns.length - 1
            }
          />
        </div>
      );
    },
    [
      sessionId,
      onContinueToolSetup,
      readOnly,
      actionsDisabled,
      awaitingLabel,
      branchingMessageId,
      canPreviewCitations,
      contentClassName,
      modelLabel,
      onBranchMessage,
      onEditMessage,
      onRetryMessage,
      onSubmitQuestionnaire,
      openCitationPreview,
      profileId,
      questionnaire,
      showThinking,
      showUsage,
      streamActive,
      turnStartedAt,
      workStreamActive,
      turns.length,
      usedPluginTools,
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
      <Conversation
        className={cn("min-h-0 flex-1", className)}
        onClickCapture={userTogglePinPause.onClickCapture}
      >
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
          scrollerRef={handleScrollerRef}
          totalListHeightChanged={handleTotalListHeightChanged}
        />
        <ConversationScrollButton />
      </Conversation>
      {/* Keep the preview mounted when Virtuoso removes the citation row. */}
      {citationPreview ? (
        <LocalCitationPreview
          key={`${citationPreview.profileId}:${citationPreview.path}`}
          onClose={closeCitationPreview}
          path={citationPreview.path}
          profileId={citationPreview.profileId}
        />
      ) : null}
    </ConversationStickinessProvider>
  );
}

function AssistantTurn({
  readOnly = false,
  sessionId,
  onContinueToolSetup,
  workStreamActive,
  messages,
  profileId,
  showThinking,
  showUsage = false,
  modelLabel,
  branchingMessageId,
  actionsDisabled,
  streamActive,
  showAwaiting,
  turnStartedAt,
  onBranchMessage,
  onOpenFileCitation,
  onRetryMessage,
  onSubmitQuestionnaire,
  questionnaire,
  questionnaireAnswers,
  usedPluginTools,
}: {
  readOnly?: boolean;
  sessionId?: string;
  onContinueToolSetup?: (setupId: string) => Promise<void>;
  workStreamActive: boolean;
  messages: IndexedMessage[];
  profileId?: string | null;
  showThinking: boolean;
  showUsage?: boolean;
  modelLabel?: string | null;
  branchingMessageId?: string | null;
  actionsDisabled?: boolean;
  streamActive: boolean;
  showAwaiting?: boolean;
  turnStartedAt?: string | null;
  onBranchMessage?: (message: ChatListItem) => void;
  onOpenFileCitation?: (path: string) => void;
  onRetryMessage?: (message: ChatListItem) => void;
  onSubmitQuestionnaire?: (answers: AgentQuestionAnswer[]) => void;
  questionnaire?: AgentQuestionnaire | null;
  questionnaireAnswers?: AgentQuestionAnswer[];
  usedPluginTools: string[];
}) {
  const turnMessages = messages.map(({ message }) => message);
  const segments = segmentAssistantTurn(turnMessages, workStreamActive);
  const artifacts = extractTurnArtifacts(turnMessages);
  const artifactTurnKey = messages.map(({ message }) => message.id).join(":");
  const anchorMessage = findAssistantTurnAnchor(turnMessages);
  const turnComplete = isAssistantTurnComplete(turnMessages);
  const interactiveTurnComplete = !readOnly && turnComplete;
  // A later tool call (`rm`, delete_file) or the Files page can remove a file
  // the transcript still names; its chip would only open a 404.
  const artifactExists = useArtifactsExist(artifacts, profileId, turnComplete);
  const liveArtifacts = artifacts.filter((_, index) => artifactExists[index]);
  // Wait for the full SSE reply (tools + final summary), not the brief gap after tool_end.
  const showArtifacts = turnComplete && liveArtifacts.length > 0;

  const showActions =
    !streamActive &&
    interactiveTurnComplete &&
    anchorMessage != null &&
    !anchorMessage.failed;

  const retryDisabled =
    actionsDisabled || branchingMessageId === anchorMessage?.id;

  const turnUsage = showUsage ? sumChatUsage(turnMessages) : undefined;

  return (
    <div className="group mr-auto ml-0 flex w-full max-w-full flex-col items-start justify-start gap-3">
      {segments.map((segment) => (
        <AssistantTurnSegmentView
          key={
            segment.kind === "work"
              ? `work:${segment.groupId ?? segment.thinking?.id ?? "thought"}`
              : `text:${segment.message.id}`
          }
          modelLabel={modelLabel}
          onOpenFileCitation={onOpenFileCitation}
          onRetryMessage={onRetryMessage}
          profileId={profileId}
          retryDisabled={retryDisabled}
          segment={segment}
          showThinking={showThinking}
        />
      ))}
      {showAwaiting && !segments.some((segment) => segment.kind === "work") ? (
        <TurnAwaitingElapsed startedAt={turnStartedAt} />
      ) : null}
      <TurnQuestionnaire
        actionsDisabled={actionsDisabled}
        answers={questionnaireAnswers}
        messages={turnMessages}
        onSubmit={onSubmitQuestionnaire}
        questionnaire={questionnaire}
      />
      {workStreamActive || !interactiveTurnComplete ? null : (
        <ToolCredentialCards
          disabled={actionsDisabled}
          messages={turnMessages}
          onContinue={onContinueToolSetup}
          sessionId={sessionId}
        />
      )}
      {profileId && showArtifacts ? (
        <TurnArtifacts
          artifacts={liveArtifacts}
          profileId={profileId}
          turnKey={artifactTurnKey}
        />
      ) : null}
      <CreatedProfiles
        complete={interactiveTurnComplete}
        messages={turnMessages}
      />
      <ComposioConnectCards
        complete={interactiveTurnComplete}
        messages={turnMessages}
        profileId={profileId}
      />
      <PluginDrafts
        complete={interactiveTurnComplete}
        messages={turnMessages}
        usedTools={usedPluginTools}
      />
      {showActions ? (
        <AssistantMessageActions
          actionsDisabled={actionsDisabled}
          busy={branchingMessageId === anchorMessage.id}
          copyContent={assistantTurnContent(turnMessages)}
          message={anchorMessage}
          onBranchMessage={onBranchMessage}
          onRetryMessage={onRetryMessage}
          usage={turnUsage}
        />
      ) : null}
    </div>
  );
}

function TurnQuestionnaire({
  actionsDisabled,
  answers,
  messages,
  onSubmit,
  questionnaire,
}: {
  actionsDisabled?: boolean;
  answers?: AgentQuestionAnswer[];
  messages: ChatListItem[];
  onSubmit?: (answers: AgentQuestionAnswer[]) => void;
  questionnaire?: AgentQuestionnaire | null;
}) {
  if (answers?.length) {
    return <AgentQuestionnaireAnswers answers={answers} />;
  }

  const asked = messages.some(
    (message) =>
      message.tool === "ask_user_question" && message.toolStatus === "done"
  );

  if (!(onSubmit && asked && hasActiveAgentQuestionnaire(questionnaire))) {
    return null;
  }

  return (
    <AgentQuestionnairePanel
      disabled={actionsDisabled}
      onSubmit={(next) => onSubmit(next)}
      questionnaire={questionnaire ?? null}
    />
  );
}

function ToolCredentialCards({
  disabled,
  messages,
  onContinue,
  sessionId,
}: {
  disabled?: boolean;
  messages: ChatListItem[];
  onContinue?: (setupId: string) => Promise<void>;
  sessionId?: string;
}) {
  return messages
    .filter((message) => message.toolResult != null)
    .map((message) => (
      <ToolCredentialCard
        disabled={disabled}
        key={message.id}
        onContinue={onContinue}
        result={message.toolResult}
        sessionId={sessionId}
      />
    ));
}

function TurnArtifacts({
  artifacts,
  profileId,
  turnKey,
}: {
  artifacts: ReturnType<typeof extractTurnArtifacts>;
  profileId: string;
  turnKey: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {artifacts.map((artifact) => {
        const chipId = `${turnKey}:${artifact.ownerProfileId ?? profileId}:${artifact.path}`;

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
  );
}

function CreatedProfiles({
  complete,
  messages,
}: {
  complete: boolean;
  messages: ChatListItem[];
}) {
  if (!complete) {
    return null;
  }

  const profiles = messages.flatMap((message) => {
    if (message.tool !== "create_profile") {
      return [];
    }

    const profile = parseProfileCreatedResult(message.toolResult);

    return profile ? [profile] : [];
  });

  const groups = messages.flatMap((message) => {
    const group =
      message.tool === "create_group"
        ? parseGroupCreatedResult(message.toolResult)
        : null;

    return group ? [group] : [];
  });

  if (profiles.length === 0 && groups.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {profiles.map((profile) => (
        <ProfileCreatedCard key={profile.id} profile={profile} />
      ))}
      {groups.map((group) => (
        <GroupCreatedCard group={group} key={group.id} />
      ))}
    </div>
  );
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Tool results are untrusted JSON decoded at this boundary.
function parseComposioConnectRequest(value: unknown) {
  const record = readRecord(value);
  const toolkitSlug = readString(record?.toolkitSlug);

  if (record?.type !== "composio_connect" || !toolkitSlug) {
    return null;
  }

  return {
    displayName: readString(record.displayName) ?? toolkitSlug,
    onAgent: record.onAgent === true,
    toolkitSlug,
  };
}

function ComposioConnectCards({
  complete,
  messages,
  profileId,
}: {
  complete: boolean;
  messages: ChatListItem[];
  profileId?: string | null;
}) {
  if (!complete) {
    return null;
  }

  const requests = new Map(
    messages.flatMap((message) => {
      const request =
        message.tool === "composio__connect_account"
          ? parseComposioConnectRequest(message.toolResult)
          : null;

      return request ? [[request.toolkitSlug, request] as const] : [];
    })
  );

  return [...requests.values()].map((request) => (
    <ComposioConnectCard
      displayName={request.displayName}
      key={request.toolkitSlug}
      onAgent={request.onAgent}
      profileId={profileId ?? null}
      toolkitSlug={request.toolkitSlug}
    />
  ));
}

const COMPOSIO_CONNECT_POLL_MS = 3000;

const COMPOSIO_CONNECT_POLL_LIMIT_MS = 5 * 60_000;

function isComposioToolkitConnected(
  toolkits: ListComposioToolkitsResponse | undefined,
  toolkitSlug: string
): boolean {
  const orgToolkit = toolkits?.orgToolkits.find(
    (item) => item.toolkitSlug === toolkitSlug
  );

  return (
    orgToolkit?.status === "enabled" &&
    (toolkits?.userConnections.some(
      (item) => item.toolkitId === orgToolkit.id && item.status === "connected"
    ) ??
      false)
  );
}

/** What the connect card shows for one app, from the org's Composio list. */
function describeComposioApp(
  toolkits: ListComposioToolkitsResponse | undefined,
  toolkitSlug: string,
  displayName: string,
  access: { canManage: boolean; isOrgAdmin: boolean; onAgent: boolean }
) {
  const catalogItem = toolkits?.catalog.find(
    (item) => item.slug === toolkitSlug
  );

  const orgToolkit = toolkits?.orgToolkits.find(
    (item) => item.toolkitSlug === toolkitSlug
  );

  const name = catalogItem?.name ?? orgToolkit?.displayName ?? displayName;

  const unknownApp =
    Boolean(toolkits?.catalog.length) && !catalogItem && !orgToolkit;

  let blockedReason: string | null = null;

  if (unknownApp) {
    blockedReason = `${name} is not in Composio.`;
  } else if (!(access.isOrgAdmin || orgToolkit?.status === "enabled")) {
    blockedReason = `Ask an org admin to turn on ${name}.`;
  } else if (!(access.canManage || access.onAgent)) {
    // Only someone who manages the agent can add the app to it.
    blockedReason = `Ask the agent owner to add ${name}.`;
  }

  return {
    blockedReason,
    // The agent can use the app only when it is on the agent too.
    connected:
      access.onAgent && isComposioToolkitConnected(toolkits, toolkitSlug),
    logoUrl: catalogItem?.logoUrl,
    name,
  };
}

/**
 * One click opens Composio sign-in in a new tab. An admin also turns the app
 * on and adds it to this agent. After the click the card checks every few
 * seconds, so it reads Connected without a tab switch.
 */
function ComposioConnectCard({
  displayName,
  onAgent: onAgentAtCall,
  profileId,
  toolkitSlug,
}: {
  displayName: string;
  /** From the tool result: the app was on the agent when the model asked. */
  onAgent: boolean;
  profileId: string | null;
  toolkitSlug: string;
}) {
  const { activeOrg, user } = useAuth();
  const queryClient = useQueryClient();
  const isOrgAdmin = activeOrg?.role === "admin";

  const [pollUntil, setPollUntil] = useState(0);

  const { data: toolkits } = useComposioToolkits({
    refetchInterval: (data) =>
      Date.now() < pollUntil && !isComposioToolkitConnected(data, toolkitSlug)
        ? COMPOSIO_CONNECT_POLL_MS
        : false,
    refetchOnWindowFocus: true,
  });

  const { data: profile } = useProfileQuery(profileId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = canManageAgent(profile, user, isOrgAdmin);

  // Only managers can read the agent's apps; a click can add one, so read live.
  const { data: agentApps } = useQuery({
    ...profileComposioToolkitsQueryOptions(profileId),
    enabled: canManage && Boolean(profileId),
  });

  const onAgent =
    agentApps?.assignments.some((item) => item.toolkitSlug === toolkitSlug) ??
    onAgentAtCall;

  const ready = Boolean(toolkits && (!profileId || profile));

  const { blockedReason, connected, logoUrl, name } = describeComposioApp(
    toolkits,
    toolkitSlug,
    displayName,
    { canManage, isOrgAdmin, onAgent }
  );

  async function connect() {
    if (!(toolkits && ready)) {
      return;
    }

    // Open the tab inside the click so the browser does not block it.
    const tab = window.open("", "_blank");

    if (tab) {
      tab.opener = null;
    }

    setPending(true);
    setError(null);

    try {
      const signInUrl = await connectComposioApp({
        isOrgAdmin,
        profileId: canManage && profileId ? profileId : undefined,
        returnTo: `/integrations?section=composio&connected=${encodeURIComponent(toolkitSlug)}`,
        toolkitSlug,
        toolkits,
      });

      if (signInUrl && tab) {
        tab.location.href = signInUrl;
        setPollUntil(Date.now() + COMPOSIO_CONNECT_POLL_LIMIT_MS);
      } else if (signInUrl) {
        window.location.href = signInUrl;
      } else {
        tab?.close();
      }

      await invalidateQueries(
        queryClient,
        queryKeys.composio.toolkits,
        queryKeys.composio.profileToolkits(profileId ?? "none")
      );
    } catch (connectError) {
      tab?.close();
      setError(formatError(connectError));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex w-fit max-w-full flex-col gap-2 rounded-xl bg-muted/40 p-3">
      <div className="flex min-w-0 items-center gap-3">
        <ComposioToolkitLogo logoUrl={logoUrl} name={name} />
        <p className="min-w-0 truncate font-medium text-foreground text-sm">
          {name}
        </p>
        {connected ? (
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-sm">
            <CheckmarkCircle01Icon aria-hidden className="size-4" />
            Connected
          </span>
        ) : (
          <Button
            className="min-h-10 shrink-0 rounded-lg transition-transform active:scale-[0.96]"
            disabled={!ready || pending || blockedReason !== null}
            onClick={() => {
              connect().catch(() => undefined);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {pending ? "Connecting…" : "Connect"}
          </Button>
        )}
      </div>
      {connected || !ready || !(blockedReason || error) ? null : (
        <p className="text-muted-foreground text-xs" role="status">
          {error ?? blockedReason}
        </p>
      )}
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

function ChatMessageRow({
  message,
  busy = false,
  disabled = false,
  onEditMessage,
}: {
  message: ChatListItem;
  busy?: boolean;
  disabled?: boolean;
  onEditMessage?: (message: ChatListItem, text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const canEdit =
    Boolean(onEditMessage) && !disabled && isEditableUserMessage(message);

  if (draft !== null && onEditMessage) {
    const trimmed = draft.trim();
    const unchanged = trimmed === message.content.trim();

    function submit() {
      if (!trimmed || unchanged) {
        return;
      }

      setDraft(null);
      onEditMessage?.(message, trimmed);
    }

    return (
      <Message
        className="mr-0 ml-auto w-full min-w-0 max-w-full items-end justify-end overflow-visible"
        from="user"
      >
        <div className="flex w-full flex-col gap-3 rounded-[1.75rem] bg-muted px-5 pt-4 pb-3.5">
          <Textarea
            autoFocus
            className="max-h-64 min-h-0 resize-none rounded-none border-0 bg-transparent p-0 text-sm leading-[1.55] tracking-[0.01em] shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setDraft(null);

                return;
              }

              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
            value={draft}
          />
          <div className="flex justify-end gap-2">
            <Button
              className="rounded-full px-4"
              onClick={() => setDraft(null)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="rounded-full px-4"
              disabled={!trimmed || unchanged || busy || disabled}
              onClick={submit}
              type="button"
            >
              Send
            </Button>
          </div>
        </div>
      </Message>
    );
  }

  return (
    <Message
      className="mr-0 ml-auto min-w-0 max-w-full items-end justify-end overflow-visible"
      from="user"
    >
      <MessageContent className="ml-auto min-w-0 max-w-full overflow-visible group-[.is-user]:ml-auto">
        <UserMessageContent message={message} />
      </MessageContent>
      {canEdit ? (
        <button
          aria-label="Edit message"
          className="mr-1 inline-flex size-8 items-center justify-center self-end rounded-lg text-muted-foreground opacity-0 transition-colors transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 group-focus-within:opacity-100 group-hover:opacity-60 group-hover:hover:opacity-100"
          disabled={busy}
          onClick={() => setDraft(message.content)}
          title="Edit message"
          type="button"
        >
          <Edit03Icon aria-hidden className="size-4" />
        </button>
      ) : null}
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
    !message.failed &&
    !message.streaming &&
    message.historyIndex != null &&
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
  usage,
}: {
  message: ChatListItem;
  copyContent: string;
  busy: boolean;
  actionsDisabled?: boolean;
  onBranchMessage?: (message: ChatListItem) => void;
  onRetryMessage?: (message: ChatListItem) => void;
  usage?: ChatUsage;
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
    <div className="flex items-center gap-1 pt-1 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 group-active:opacity-100">
      {usage ? <ChatUsageBadge usage={usage} /> : null}
      <button
        aria-label={copied ? "Copied" : "Copy response"}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40",
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
          className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
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
                  "inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
      <ol className="-my-1 divide-y divide-border">
        {message.questionnaireAnswers.map((entry, index) => (
          <li
            className="flex gap-3 py-2.5"
            key={`${entry.questionId}:${entry.prompt}`}
          >
            <span className="w-4 shrink-0 text-13 text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <div className="min-w-0 space-y-0.5">
              <p className="whitespace-pre-wrap text-13 text-muted-foreground">
                {entry.prompt}
              </p>
              <p className="whitespace-pre-wrap font-medium text-[15px] text-foreground leading-snug">
                {entry.answer}
              </p>
            </div>
          </li>
        ))}
      </ol>
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
            <DocumentAttachmentPreview
              document={document}
              key={document.attachmentId ?? document.url ?? document.filename}
            />
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
