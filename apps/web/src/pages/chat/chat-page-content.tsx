import { formatAgentQuestionnaireAnswersMessage } from "@nakama/core/agent-questionnaire";
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { ArtifactStreamingPanelBridge } from "@/components/chat/artifact-streaming-panel-bridge";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatAttachmentPanelProvider } from "@/context/chat-attachment-panel-context";
import { usePostTurnSkillReviewOverlay } from "@/hooks/use-post-turn-skill-review-overlay";
import { formatSessionChannelLabel } from "@/lib/chat-history";
import { extractModelId } from "@/lib/models";
import { ChatPageColumn, ChatWelcome } from "@/pages/chat/chat-page-layout";
import type { ChatPageState } from "@/pages/chat/use-chat-page";

export function ChatPageContent(state: ChatPageState) {
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
    turnStartedAt,
    canStop,
    error,
    composerDraft,
    setComposerDraft,
    queuedMessages,
    branchingMessageId,
    showOfflineHint,
    health,
    providerModelGroups,
    currentModelSelection,
    activeModelSupportsVision,
    showThinking,
    thinkingEffortVisible,
    thinkingEffort,
    thinkingEffortDisabled,
    readOnlySession,
    isEmptyState,
    composerDisabled,
    sessionChannel,
    contextUsage,
    handleProfileSwitch,
    handleModelChange,
    handleThinkingEffortChange,
    renderModelLabel,
    handleBranchMessage,
    handleTryAgainMessage,
    sendMessage,
    stopStreaming,
    navigateSetup,
    agentTodos,
    agentQuestionnaire,
  } = state;

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
    <PromptInputProvider
      initialInput={composerDraft}
      key={composerDraft || "empty"}
    >
      {skillReviewBanner}
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
        error={error}
        onModelChange={handleModelChange}
        onNavigateSetup={navigateSetup}
        onStop={stopStreaming}
        onSubmit={(text, files) => {
          setComposerDraft("");
          void sendMessage(text, files);
        }}
        onSubmitQuestionnaire={(answers) => {
          setComposerDraft("");
          void sendMessage(
            formatAgentQuestionnaireAnswersMessage(answers),
            [],
            {
              questionnaireAnswers: answers,
            }
          );
        }}
        onThinkingEffortChange={handleThinkingEffortChange}
        primarySupportsVision={activeModelSupportsVision}
        profileModelId={extractModelId(activeProfile?.model)}
        providerConfigured={health?.providerConfigured}
        providerModelGroups={providerModelGroups}
        questionnaire={agentQuestionnaire}
        queuedMessages={queuedMessages}
        renderModelLabel={renderModelLabel}
        showOfflineHint={showOfflineHint}
        showTips={isEmptyState}
        thinkingEffort={thinkingEffort}
        thinkingEffortDisabled={thinkingEffortDisabled}
        thinkingEffortVisible={thinkingEffortVisible}
        todos={agentTodos}
      />
    </PromptInputProvider>
  );

  if (isEmptyState) {
    return (
      <ChatAttachmentPanelProvider key={session?.id ?? "new"}>
        <ChatPageColumn centered>
          <div className="mx-auto mb-12 flex w-full max-w-3xl flex-col gap-1">
            <ChatWelcome
              onProfileSwitch={handleProfileSwitch}
              profile={activeProfile}
              profileId={profileId}
              profileSwitchDisabled={busy}
              profiles={profiles}
            />
            {composer}
          </div>
        </ChatPageColumn>
      </ChatAttachmentPanelProvider>
    );
  }

  return (
    <ChatAttachmentPanelProvider key={session?.id ?? "new"}>
      <ArtifactStreamingPanelBridge messages={messages} profileId={profileId} />
      <ChatPageColumn>
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ChatMessageList
              actionsDisabled={busy || readOnlySession}
              branchingMessageId={branchingMessageId}
              messages={messages}
              modelLabel={
                currentModelSelection
                  ? renderModelLabel(currentModelSelection)
                  : null
              }
              onBranchMessage={(message) => void handleBranchMessage(message)}
              onRetryMessage={(message) => void handleTryAgainMessage(message)}
              profileId={profileId}
              showThinking={showThinking}
              streamActive={busy}
              turnStartedAt={turnStartedAt}
            />
          </div>

          <div className="sticky bottom-0 z-10 mt-auto w-full shrink-0 bg-background/95 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/85">
            {composer}
          </div>
        </div>
      </ChatPageColumn>
    </ChatAttachmentPanelProvider>
  );
}
