import type {
  ProfileSummary,
  StoredTask,
  ThinkingEffort,
} from "@nakama/core/contract";
import { useQueryClient } from "@tanstack/react-query";
import type { FileUIPart } from "ai";
import { Cancel01Icon } from "hugeicons-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAppContext } from "@/context/use-app-context";
import { useProfileQuery } from "@/hooks/use-app-queries";
import { useUpdateProfileMutation } from "@/hooks/use-resource-mutations";
import { useTaskMessagesQuery } from "@/hooks/use-tasks";
import {
  buildThinkingSettingsPayload,
  useSaveThinkingSettings,
  useThinkingSettings,
} from "@/hooks/use-thinking-settings";
import { type ChatListItem, chatMessagesToListItems } from "@/lib/chat-history";
import {
  filePartsToDisplayDocuments,
  filePartsToDocumentAttachments,
  filePartsToImageAttachments,
} from "@/lib/chat-images";
import {
  appendOutgoingMessages,
  buildStreamHandlers,
  deriveChatStatus,
  finalizeStreamingMessages,
  isAbortError,
} from "@/lib/chat-stream";
import { client, formatError } from "@/lib/client";
import {
  decodeModelSelection,
  effectiveProfileModelSelection,
  extractModelId,
  groupModelsByProvider,
  resolveModelThinkingSupport,
  resolveModelVisionSupport,
} from "@/lib/models";
import { NAV_ITEM_ICONS, SETUP_PATH } from "@/lib/navigation";
import { queryKeys } from "@/lib/query-keys";
import { TASK_STATUS_BADGE } from "@/lib/task-board";
import {
  DEFAULT_THINKING_EFFORT,
  shouldBlockThinkingEffortChange,
  shouldShowThinkingEffort,
} from "@/lib/thinking-settings";
import { cn } from "@/lib/utils";

const ChatNavIcon = NAV_ITEM_ICONS.chat;

interface TaskRunHistoryPanelProps {
  onClose: () => void;
  profile?: ProfileSummary | null;
  task: StoredTask;
}

export function TaskRunHistoryPanel({
  task,
  profile,
  onClose,
}: TaskRunHistoryPanelProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { health, models } = useAppContext();
  const profileId = profile?.id ?? task.profileId;
  const profileDetailQuery = useProfileQuery(profileId || null);
  const updateProfileMutation = useUpdateProfileMutation();
  const { data: thinkingSettings, isLoading: thinkingSettingsLoading } =
    useThinkingSettings();
  const saveThinkingSettingsMutation = useSaveThinkingSettings();
  const {
    data,
    isLoading,
    isFetching,
    error: loadError,
  } = useTaskMessagesQuery(task.id);

  // Prefetch can resolve before mount; seed from cached query data so the
  // data!==syncedData sync is not skipped when both start as the same reference.
  const [messages, setMessages] = useState<ChatListItem[]>(() =>
    data ? chatMessagesToListItems(data.messages) : []
  );
  const [sessionId, setSessionId] = useState<string | null>(
    () => data?.sessionId || task.sessionId
  );
  const [busy, setBusy] = useState(false);
  const [canStop, setCanStop] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamAbortRef = useRef<AbortController | null>(null);
  const statusBadge = TASK_STATUS_BADGE[task.status];
  const profileLabel = profile?.name ?? task.profileId;
  const availableSkills = profileDetailQuery.data?.skills ?? [];

  const providerModelGroups = useMemo(
    () => groupModelsByProvider(models?.models ?? []),
    [models?.models]
  );

  const currentModelSelection = useMemo(
    () => effectiveProfileModelSelection(profile?.model, providerModelGroups),
    [profile?.model, providerModelGroups]
  );

  const renderModelLabel = useCallback(
    (selection: string | null) => {
      if (!selection) {
        return "Select model";
      }
      const decoded = decodeModelSelection(selection);
      if (!decoded) {
        return selection;
      }
      if (decoded.providerId === "__unknown__") {
        return decoded.modelId;
      }
      const group = providerModelGroups.find(
        (entry) => entry.providerId === decoded.providerId
      );
      return (
        group?.models.find((model) => model.id === decoded.modelId)?.name ??
        decoded.modelId
      );
    },
    [providerModelGroups]
  );

  const activeModelSupportsThinking = useMemo(
    () =>
      resolveModelThinkingSupport(currentModelSelection, providerModelGroups),
    [currentModelSelection, providerModelGroups]
  );

  const activeModelSupportsVision = useMemo(
    () => resolveModelVisionSupport(currentModelSelection, providerModelGroups),
    [currentModelSelection, providerModelGroups]
  );

  const thinkingEffortVisible = shouldShowThinkingEffort(
    activeModelSupportsThinking
  );
  const thinkingEffort = thinkingSettings?.effort ?? DEFAULT_THINKING_EFFORT;
  const thinkingEffortDisabled =
    busy || thinkingSettingsLoading || saveThinkingSettingsMutation.isPending;

  const waitingForMessages = isLoading || (isFetching && messages.length === 0);
  const [syncedData, setSyncedData] = useState(data);

  if (data !== syncedData) {
    setSyncedData(data);
    if (data) {
      setSessionId(data.sessionId || task.sessionId);
      setMessages(chatMessagesToListItems(data.messages));
      setError(null);

      if (!task.sessionId && data.sessionId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      }
    }
  }

  const chatStatus = useMemo(
    () => deriveChatStatus(busy, error, messages),
    [busy, error, messages]
  );

  const stopStreaming = useCallback(() => {
    streamAbortRef.current?.abort();
  }, []);

  const handleModelChange = useCallback(
    (selection: string) => {
      if (!(profileId && selection)) {
        return;
      }
      const decoded = decodeModelSelection(selection);
      if (!decoded) {
        return;
      }
      void updateProfileMutation
        .mutateAsync({ input: { model: selection }, profileId })
        .catch((err) => {
          setError(formatError(err));
        });
    },
    [profileId, updateProfileMutation]
  );

  const handleThinkingEffortChange = useCallback(
    (effort: ThinkingEffort) => {
      if (!profileId || effort === thinkingEffort) {
        return;
      }

      if (
        shouldBlockThinkingEffortChange(busy) ||
        saveThinkingSettingsMutation.isPending
      ) {
        if (busy) {
          setError("Wait for the current response to finish.");
        }
        return;
      }

      void saveThinkingSettingsMutation
        .mutateAsync(buildThinkingSettingsPayload(effort))
        .catch((err) => {
          setError(formatError(err));
        });
    },
    [profileId, thinkingEffort, busy, saveThinkingSettingsMutation]
  );

  const sendMessage = useCallback(
    async (text: string, files: FileUIPart[] = []) => {
      if ((!text.trim() && files.length === 0) || busy || !sessionId) {
        return;
      }

      setBusy(true);
      setError(null);

      const images = filePartsToImageAttachments(files);
      const documents = filePartsToDocumentAttachments(files);
      const displayDocuments = filePartsToDisplayDocuments(files);
      const displayImages = images.map((image) => ({
        mediaType: image.mediaType,
        url: `data:${image.mediaType};base64,${image.data}`,
      }));
      const useImageAttachments = activeModelSupportsVision === false;

      const chatSession = client.createChatSession(sessionId, "task");
      appendOutgoingMessages(
        setMessages,
        text,
        useImageAttachments ? [] : displayImages,
        displayDocuments.length > 0 ? displayDocuments : undefined,
        {
          imageAttachments:
            useImageAttachments && displayImages.length > 0
              ? displayImages
              : undefined,
          thinkingEnabled: thinkingEffortVisible,
        }
      );

      const abortController = new AbortController();
      streamAbortRef.current = abortController;
      setCanStop(true);

      try {
        await chatSession.sendStream(
          {
            documents: documents.length > 0 ? documents : undefined,
            images: images.length > 0 ? images : undefined,
            message: text,
          },
          buildStreamHandlers(setMessages),
          { signal: abortController.signal }
        );

        setMessages((current) => finalizeStreamingMessages(current));
        void queryClient.invalidateQueries({
          queryKey: queryKeys.tasks.messages(task.id),
        });
      } catch (err) {
        if (isAbortError(err)) {
          setMessages((current) => finalizeStreamingMessages(current));
          return;
        }

        setError(formatError(err));
        setMessages((current) =>
          current.filter((message) => !message.streaming)
        );
      } finally {
        streamAbortRef.current = null;
        setCanStop(false);
        setBusy(false);
      }
    },
    [
      activeModelSupportsVision,
      busy,
      queryClient,
      sessionId,
      task.id,
      thinkingEffortVisible,
    ]
  );

  const displayError = error ?? (loadError ? formatError(loadError) : null);
  const chatUnavailable =
    !(sessionId || waitingForMessages) && messages.length > 0;
  const emptyHistory =
    !(waitingForMessages || displayError) && messages.length === 0;
  const showOfflineHint = health?.providerConfigured === false;

  return (
    <aside
      aria-label={`Run chat for ${task.title}`}
      className={cn(
        "flex min-h-[24rem] shrink-0 flex-col bg-background",
        "border-border/50 border-t",
        "lg:h-full lg:min-h-0 lg:w-[24rem] lg:border-border/30 lg:border-t-0 lg:border-l",
        "xl:w-[26rem]"
      )}
    >
      <header className="flex items-start justify-between gap-3 border-border/50 border-b bg-muted/20 px-4 py-3 sm:px-5">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <ChatNavIcon
              aria-hidden
              className="sidebar-nav-icon text-muted-foreground"
              strokeWidth={2}
            />
            <p className="type-label">Run chat</p>
          </div>
          <h2 className="type-section-title truncate">{task.title}</h2>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-medium text-2xs",
                statusBadge.className
              )}
            >
              {statusBadge.label}
            </span>
            <span className="truncate text-muted-foreground text-xs">
              {profileLabel}
            </span>
          </div>
        </div>
        <Button
          aria-label="Close task chat"
          className="relative shrink-0 after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2"
          onClick={onClose}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Cancel01Icon aria-hidden className="size-4" strokeWidth={2} />
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        {waitingForMessages ? (
          <div className="flex h-full min-h-48 items-center justify-center">
            <Spinner className="size-5" />
          </div>
        ) : (
          <ChatMessageList
            className="absolute inset-0 bg-background"
            contentClassName="px-4 sm:px-5"
            emptyMessage={
              emptyHistory
                ? "No run output yet. Open task details or run the agent again."
                : undefined
            }
            messages={messages}
          />
        )}
      </div>

      {displayError ? (
        <div className="shrink-0 border-border/50 border-t px-4 py-3 sm:px-5">
          <p className="text-pretty text-red-700 text-sm dark:text-red-300">
            {displayError}
          </p>
        </div>
      ) : null}

      {chatUnavailable ? (
        <div className="shrink-0 border-border/50 border-t px-4 py-3 sm:px-5">
          <p className="text-pretty text-muted-foreground text-sm">
            Run history is shown above. Restart the Nakama server to enable
            follow-up chat.
          </p>
        </div>
      ) : (
        <PromptInputProvider>
          <ChatComposer
            availableSkills={availableSkills}
            busy={busy}
            canStop={canStop}
            chatStatus={chatStatus}
            className="border-border/50 border-t px-4 py-4 sm:px-5"
            currentModelSelection={currentModelSelection}
            disabled={!sessionId || waitingForMessages}
            error={displayError}
            onModelChange={handleModelChange}
            onNavigateSetup={() => navigate(SETUP_PATH)}
            onStop={stopStreaming}
            onSubmit={(text, files) => void sendMessage(text, files)}
            onThinkingEffortChange={handleThinkingEffortChange}
            placeholder="Follow up on this task…"
            primarySupportsVision={activeModelSupportsVision}
            profileModelId={extractModelId(profile?.model)}
            providerConfigured={health?.providerConfigured}
            providerModelGroups={providerModelGroups}
            renderModelLabel={renderModelLabel}
            showOfflineHint={showOfflineHint}
            thinkingEffort={thinkingEffort}
            thinkingEffortDisabled={thinkingEffortDisabled}
            thinkingEffortVisible={thinkingEffortVisible}
          />
        </PromptInputProvider>
      )}
    </aside>
  );
}
