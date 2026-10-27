import {
  formatAgentQuestionnaireAnswersMessage,
  hasActiveAgentQuestionnaire,
} from "@nakama/core/agent-questionnaire";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Spinner } from "@nakama/ui/spinner";
import { lazy, type ReactNode, Suspense, useMemo, useState } from "react";
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { ArtifactStreamingPanelBridge } from "@/components/chat/artifact-streaming-panel-bridge";
import { BrowserLiveViewPanelBridge } from "@/components/chat/browser-live-view-panel-bridge";
import { ChatCognitoControl } from "@/components/chat/chat-cognito-control";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { UserContextEditorDialog } from "@/components/UserContextCard";
import { ChatAttachmentPanelProvider } from "@/context/chat-attachment-panel-context";
import { useChatUsageVisible } from "@/hooks/use-chat-usage-visible";
import { usePostTurnSkillReviewOverlay } from "@/hooks/use-post-turn-skill-review-overlay";
import { formatSessionChannelLabel } from "@/lib/chat-history";
import { sumChatUsage } from "@/lib/chat-usage";
import { extractModelId } from "@/lib/models";
import {
  ChatGoalPrompt,
  ChatSetupChecklist,
  ChatSetupFinding,
  ChatSetupPill,
} from "@/pages/chat/chat-onboarding";
import { shouldShowCognitoControl } from "@/pages/chat/chat-page.shared";
import { ChatPageColumn, ChatWelcome } from "@/pages/chat/chat-page-layout";
import {
  type Onboarding,
  useOnboarding,
} from "@/pages/chat/use-chat-onboarding";
import type { ChatPageState } from "@/pages/chat/use-chat-page";

const ProviderSetupForm = lazy(async () => ({
  default: (await import("@/components/ProviderSetupForm")).ProviderSetupForm,
}));

export function ChatPageContent({
  below,
  cognitoLocked = false,
  onBtw,
  ...state
}: ChatPageState & {
  below?: ReactNode;
  /** Cognito cannot be turned off here: no toggle, no cognito surface. */
  cognitoLocked?: boolean;
  onBtw?: (question: string) => void;
}) {
  const {
    session,
    messages,
    profileId,
    profiles,
    activeProfile,
    availableSkills,
    chatStatus,
    busy,
    lastSuccessfulTurnAt,
    canStop,
    error,
    composerDraftKey,
    composerEntry,
    queuedMessages,
    showOfflineHint,
    health,
    providerModelGroups,
    currentModelSelection,
    activeModelSupportsVision,
    thinkingEffortVisible,
    thinkingEffort,
    thinkingEffortDisabled,
    thinkingEffortOptions,
    readOnlySession,
    isEmptyState,
    composerDisabled,
    sessionChannel,
    contextUsage,
    handleProfileSwitch,
    handleModelChange,
    handleThinkingEffortChange,
    renderModelLabel,
    cognito,
    handleCognitoChange,
    sendMessage,
    stopStreaming,
    agentTodos,
    agentQuestionnaire,
    promptHistoryRef,
  } = state;

  const [providerDialogOpen, setProviderDialogOpen] = useState(false);

  const onboarding = useOnboarding({
    cognito,
    cognitoLocked,
    isEmptyState,
    profileId,
    readOnlySession,
  });

  // A locked cognito chat looks like a normal one: it has no other mode.
  const cognitoSurface = cognito && !cognitoLocked;

  const cognitoControl =
    !cognitoLocked && shouldShowCognitoControl(cognito, isEmptyState) ? (
      // Pinned to the column's top-right corner, which is the top right of the
      // screen area. The backdrop keeps it readable over a scrolling transcript.
      <div className="absolute top-2 right-3 z-20 rounded-full backdrop-blur sm:right-6">
        <ChatCognitoControl
          cognito={cognito}
          disabled={busy || readOnlySession}
          onCognitoChange={handleCognitoChange}
        />
      </div>
    ) : null;

  const { visible: showUsage } = useChatUsageVisible();
  const sessionUsage = useMemo(() => sumChatUsage(messages), [messages]);

  const { banner: skillReviewBanner } = usePostTurnSkillReviewOverlay({
    lastSuccessfulTurnAt,
    profile: activeProfile,
    readOnlySession,
    sessionChannel,
    sessionId: session?.id ?? null,
  });

  const readOnlyBanner = readOnlySession ? (
    <p className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
      View-only {formatSessionChannelLabel(sessionChannel)} conversation. Reply
      from {formatSessionChannelLabel(sessionChannel)}.
    </p>
  ) : null;

  const composer = (
    <>
      {readOnlyBanner}
      <ChatComposer
        availableSkills={availableSkills}
        busy={busy}
        canStop={canStop}
        chatStatus={chatStatus}
        className={
          isEmptyState && !error
            ? "z-10 py-0 [&>p:first-child]:min-h-0"
            : "z-10 py-0"
        }
        contextUsage={contextUsage}
        currentModelSelection={currentModelSelection}
        disabled={composerDisabled}
        draftStorageKey={composerDraftKey}
        error={error}
        headerNotice={skillReviewBanner}
        onBtw={onBtw}
        onConnectProvider={() => setProviderDialogOpen(true)}
        onModelChange={handleModelChange}
        onStop={stopStreaming}
        onSubmit={(text, files) => {
          void sendMessage(text, files);
        }}
        onThinkingEffortChange={handleThinkingEffortChange}
        placeholder={isEmptyState ? composerEntry.placeholder : undefined}
        primarySupportsVision={activeModelSupportsVision}
        profileId={profileId}
        profileModelId={extractModelId(currentModelSelection)}
        promptHistoryRef={promptHistoryRef}
        providerConfigured={health?.providerConfigured}
        providerModelGroups={providerModelGroups}
        queuedMessages={queuedMessages}
        renderModelLabel={renderModelLabel}
        sessionUsage={sessionUsage}
        showOfflineHint={showOfflineHint}
        showTips={isEmptyState}
        thinkingEffort={thinkingEffort}
        thinkingEffortDisabled={thinkingEffortDisabled}
        thinkingEffortOptions={thinkingEffortOptions}
        thinkingEffortVisible={thinkingEffortVisible}
        todos={
          hasActiveAgentQuestionnaire(agentQuestionnaire) ? [] : agentTodos
        }
      />
    </>
  );

  const content = isEmptyState ? (
    <ChatAttachmentPanelProvider below={below} key={session?.id ?? "new"}>
      <ChatPageColumn centered cognito={cognitoSurface}>
        {cognitoControl}
        <div className="mx-auto mb-12 flex w-full max-w-3xl flex-col gap-1">
          <EmptyChatBody onboarding={onboarding}>
            <ChatWelcome
              cognito={cognito}
              onProfileSwitch={handleProfileSwitch}
              profile={activeProfile}
              profileId={profileId}
              profileSwitchDisabled={busy}
              profiles={profiles}
            />
            {composer}
          </EmptyChatBody>
        </div>
      </ChatPageColumn>
    </ChatAttachmentPanelProvider>
  ) : (
    <ChatConversation
      below={below}
      cognitoControl={cognitoControl}
      cognitoSurface={cognitoSurface}
      composer={composer}
      showUsage={showUsage}
      state={state}
    />
  );

  return (
    <PromptInputProvider
      initialInput={composerEntry.initialInput}
      key={`${composerDraftKey}:${composerEntry.revision}`}
    >
      {content}
      <Dialog onOpenChange={setProviderDialogOpen} open={providerDialogOpen}>
        <DialogContent className="w-[min(96vw,56rem)] grid-cols-1 sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Connect provider</DialogTitle>
          </DialogHeader>
          <Suspense fallback={<Spinner className="size-6" />}>
            <ProviderSetupForm
              onSuccess={() => setProviderDialogOpen(false)}
              showHeading={false}
              submitLabel="Connect provider"
            />
          </Suspense>
        </DialogContent>
      </Dialog>
    </PromptInputProvider>
  );
}

/** Swaps the welcome and composer for the onboarding step that is active. */
function EmptyChatBody({
  children,
  onboarding,
}: {
  children: ReactNode;
  onboarding: Onboarding;
}) {
  const dialog = (
    <UserContextEditorDialog
      onOpenChange={onboarding.setAboutYouOpen}
      onSaved={onboarding.markAboutYouSaved}
      open={onboarding.aboutYouOpen}
    />
  );

  switch (onboarding.view) {
    case "goal":
      return (
        <ChatGoalPrompt
          error={onboarding.goalError}
          onSave={onboarding.saveGoal}
          onSkip={onboarding.skipGoal}
          saving={onboarding.savingGoal}
        />
      );
    case "finding":
      return <ChatSetupFinding goal={onboarding.goal} />;
    case "checklist":
      return (
        <>
          <ChatSetupChecklist
            busyKey={onboarding.busyKey}
            error={onboarding.actionError}
            goal={onboarding.goal}
            onAction={onboarding.runAction}
            onFinish={onboarding.finish}
            onSkipRest={onboarding.skipRest}
            rows={onboarding.rows}
          />
          {dialog}
        </>
      );
    default:
      return (
        <>
          {onboarding.pill ? (
            <ChatSetupPill
              done={onboarding.pill.done}
              onOpen={onboarding.openChecklist}
              total={onboarding.pill.total}
            />
          ) : null}
          {children}
        </>
      );
  }
}

function ChatConversation({
  below,
  cognitoControl,
  cognitoSurface,
  composer,
  showUsage,
  state,
}: {
  below?: ReactNode;
  cognitoControl: ReactNode;
  cognitoSurface: boolean;
  composer: ReactNode;
  showUsage: boolean;
  state: ChatPageState;
}) {
  const {
    agentQuestionnaire,
    branchingMessageId,
    busy,
    currentModelSelection,
    handleBranchMessage,
    handleEditMessage,
    handleTryAgainMessage,
    messages,
    profileId,
    queuedMessages,
    readOnlySession,
    renderModelLabel,
    sendMessage,
    session,
    showThinking,
    turnStartedAt,
  } = state;

  return (
    <ChatAttachmentPanelProvider below={below} key={session?.id ?? "new"}>
      <ArtifactStreamingPanelBridge messages={messages} profileId={profileId} />
      <BrowserLiveViewPanelBridge messages={messages} sessionId={session?.id} />
      <ChatPageColumn cognito={cognitoSurface}>
        {cognitoControl}
        <div className="mx-auto flex min-h-0 w-full flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ChatMessageList
              actionsDisabled={busy || readOnlySession}
              branchingMessageId={branchingMessageId}
              contentClassName="mx-auto w-full max-w-3xl px-4"
              messages={messages}
              modelLabel={
                currentModelSelection
                  ? renderModelLabel(currentModelSelection)
                  : null
              }
              onBranchMessage={(message) => void handleBranchMessage(message)}
              onContinueToolSetup={async (setupId) => {
                await sendMessage(
                  `Build the approved tool setup ${setupId}. Use this setupId with create_tool to connect the saved credentials and selected agent.`,
                  []
                );
              }}
              onEditMessage={(message, text) =>
                void handleEditMessage(message, text)
              }
              onRetryMessage={(message) => void handleTryAgainMessage(message)}
              onSubmitQuestionnaire={(answers) => {
                void sendMessage(
                  formatAgentQuestionnaireAnswersMessage(answers),
                  [],
                  { questionnaireAnswers: answers }
                );
              }}
              profileId={profileId}
              questionnaire={
                !busy && queuedMessages.length === 0 ? agentQuestionnaire : null
              }
              sessionId={session?.id}
              showThinking={showThinking}
              showUsage={showUsage}
              streamActive={busy}
              turnStartedAt={turnStartedAt}
              workStreamActive={turnStartedAt !== null}
            />
          </div>

          <div className="sticky bottom-0 z-10 mt-auto w-full shrink-0 bg-background/95 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:pt-4 sm:pb-4">
            <div className="mx-auto w-full max-w-3xl">{composer}</div>
          </div>
        </div>
      </ChatPageColumn>
    </ChatAttachmentPanelProvider>
  );
}
