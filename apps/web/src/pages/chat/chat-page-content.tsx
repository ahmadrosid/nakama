import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { ChatAttachmentPanelProvider } from "@/context/chat-attachment-panel-context";
import { ArtifactStreamingPanelBridge } from "@/components/chat/artifact-streaming-panel-bridge";
import { formatAgentQuestionnaireAnswersMessage } from "@nakama/core/agent-questionnaire";
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
    readOnlySession,
    isEmptyState,
    composerDisabled,
    sessionChannel,
    handleProfileSwitch,
    handleModelChange,
    renderModelLabel,
    handleBranchMessage,
    handleTryAgainMessage,
    sendMessage,
    stopStreaming,
    navigateSetup,
    agentTodos,
    agentQuestionnaire,
  } = state;

  const readOnlyBanner = readOnlySession ? (
    <p className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
      View-only {formatSessionChannelLabel(sessionChannel)} conversation. Reply from{" "}
      {formatSessionChannelLabel(sessionChannel)}.
    </p>
  ) : null;

  const composer = (
    <PromptInputProvider key={composerDraft || "empty"} initialInput={composerDraft}>
      {readOnlyBanner}
      <ChatComposer
        className={isEmptyState && !error ? "py-0 [&>p:first-child]:min-h-0" : "py-0"}
        chatStatus={chatStatus}
        busy={busy}
        canStop={canStop}
        disabled={composerDisabled}
        error={error}
        profileId={profileId}
        profiles={profiles}
        activeProfile={activeProfile}
        availableSkills={availableSkills}
        onProfileSwitch={handleProfileSwitch}
        showProfileSwitch={!isEmptyState}
        showOfflineHint={showOfflineHint}
        providerConfigured={health?.providerConfigured}
        onNavigateSetup={navigateSetup}
        providerModelGroups={providerModelGroups}
        profileModelId={extractModelId(activeProfile?.model)}
        currentModelSelection={currentModelSelection}
        primarySupportsVision={activeModelSupportsVision}
        onModelChange={handleModelChange}
        renderModelLabel={renderModelLabel}
        todos={agentTodos}
        questionnaire={agentQuestionnaire}
        queuedMessages={queuedMessages}
        onSubmitQuestionnaire={(answers) => {
          setComposerDraft("");
          void sendMessage(formatAgentQuestionnaireAnswersMessage(answers), [], {
            questionnaireAnswers: answers,
          });
        }}
        onSubmit={(text, files) => {
          setComposerDraft("");
          void sendMessage(text, files);
        }}
        onStop={stopStreaming}
      />
    </PromptInputProvider>
  );

  if (isEmptyState) {
    return (
      <ChatAttachmentPanelProvider key={session?.id ?? "new"}>
        <ChatPageColumn centered>
          <div className="mx-auto mb-12 flex w-full max-w-3xl flex-col gap-1">
            <ChatWelcome
              profile={activeProfile}
              profileId={profileId}
              profiles={profiles}
              onProfileSwitch={handleProfileSwitch}
              profileSwitchDisabled={busy}
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
              messages={messages}
              profileId={profileId}
              showThinking={showThinking}
              modelLabel={
                currentModelSelection ? renderModelLabel(currentModelSelection) : null
              }
              branchingMessageId={branchingMessageId}
              actionsDisabled={busy || readOnlySession}
              streamActive={busy}
              onBranchMessage={(message) => void handleBranchMessage(message)}
              onRetryMessage={(message) => void handleTryAgainMessage(message)}
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
