import { formatAgentQuestionnaireAnswersMessage } from "@nakama/core/agent-questionnaire";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { useMemo, useState } from "react";
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { ArtifactStreamingPanelBridge } from "@/components/chat/artifact-streaming-panel-bridge";
import { ChatCognitoControl } from "@/components/chat/chat-cognito-control";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ProviderSetupForm } from "@/components/ProviderSetupForm";
import { ChatAttachmentPanelProvider } from "@/context/chat-attachment-panel-context";
import { useChatUsageVisible } from "@/hooks/use-chat-usage-visible";
import { usePostTurnSkillReviewOverlay } from "@/hooks/use-post-turn-skill-review-overlay";
import { formatSessionChannelLabel } from "@/lib/chat-history";
import { sumChatUsage } from "@/lib/chat-usage";
import { extractModelId } from "@/lib/models";
import { shouldShowCognitoControl } from "@/pages/chat/chat-page.shared";
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
    composerDraftKey,
    composerEntry,
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
    cognito,
    handleBranchMessage,
    handleCognitoChange,
    handleEditMessage,
    handleTryAgainMessage,
    sendMessage,
    stopStreaming,
    agentTodos,
    agentQuestionnaire,
  } = state;

  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const cognitoControl = shouldShowCognitoControl(cognito, isEmptyState) ? (
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
        onConnectProvider={() => setProviderDialogOpen(true)}
        onModelChange={handleModelChange}
        onStop={stopStreaming}
        onSubmit={(text, files) => {
          void sendMessage(text, files);
        }}
        onSubmitQuestionnaire={(answers) => {
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
        profileId={profileId}
        profileModelId={extractModelId(currentModelSelection)}
        providerConfigured={health?.providerConfigured}
        providerModelGroups={providerModelGroups}
        questionnaire={agentQuestionnaire}
        queuedMessages={queuedMessages}
        renderModelLabel={renderModelLabel}
        sessionUsage={sessionUsage}
        showOfflineHint={showOfflineHint}
        showTips={isEmptyState}
        thinkingEffort={thinkingEffort}
        thinkingEffortDisabled={thinkingEffortDisabled}
        thinkingEffortVisible={thinkingEffortVisible}
        todos={agentTodos}
      />
    </>
  );

  const content = isEmptyState ? (
    <ChatAttachmentPanelProvider key={session?.id ?? "new"}>
      <ChatPageColumn centered cognito={cognito}>
        {cognitoControl}
        <div className="mx-auto mb-12 flex w-full max-w-3xl flex-col gap-1">
          <ChatWelcome
            cognito={cognito}
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
  ) : (
    <ChatAttachmentPanelProvider key={session?.id ?? "new"}>
      <ArtifactStreamingPanelBridge messages={messages} profileId={profileId} />
      <ChatPageColumn cognito={cognito}>
        {cognitoControl}
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
              profileId={profileId}
              sessionId={session?.id}
              showThinking={showThinking}
              showUsage={showUsage}
              streamActive={busy}
              turnStartedAt={turnStartedAt}
            />
          </div>

          <div className="sticky bottom-0 z-10 mt-auto w-full shrink-0 bg-background/95 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:pt-4 sm:pb-4">
            {composer}
          </div>
        </div>
      </ChatPageColumn>
    </ChatAttachmentPanelProvider>
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
          <ProviderSetupForm
            onSuccess={() => setProviderDialogOpen(false)}
            showHeading={false}
            submitLabel="Connect provider"
          />
        </DialogContent>
      </Dialog>
    </PromptInputProvider>
  );
}
