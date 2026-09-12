import type { RemoteChatSession } from "@nakama/client";
import type {
  AgentChannel,
  AgentQuestionAnswer,
  AgentQuestionnaire,
  AgentTodo,
  ChatContextUsage,
  ProfileSummary,
  ThinkingEffort,
} from "@nakama/core/contract";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type { QueuedComposerMessage } from "@/components/chat/ChatMessageQueuePanel";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useAppContext } from "@/context/use-app-context";
import { useAuth } from "@/context/use-auth";
import {
  buildThinkingSettingsPayload,
  useProfileQuery,
  useSaveThinkingSettings,
  useThinkingSettings,
} from "@/hooks/use-app-queries";
import {
  useBranchSessionMutation,
  useUpdateSessionMutation,
} from "@/hooks/use-resource-mutations";
import type { FileUIPart } from "@/lib/ai-ui-types";
import {
  buildChatBasePath,
  buildChatPath,
  buildNewChatPath,
  type ChatListItem,
  chatComposerDraftKey,
  chatMessagesToListItems,
  clearFailedChatTurn,
  consumeStoredChatDraft,
  isEditableUserMessage,
  isReadOnlySessionChannel,
  parseChatRouteParams,
  readComposerDraft,
  readFailedChatTurn,
  readInitialDraftChatProfileId,
  readLastChatModel,
  readRequestedDraftFromNewChatSearch,
  readRequestedDraftKeyFromNewChatSearch,
  readRequestedProfileFromNewChatSearch,
  sessionStorageKey,
  storeComposerDraft,
  storeFailedChatTurn,
  writeLastChatModel,
} from "@/lib/chat-history";
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
import {
  isActiveTurnConflictError,
  reconnectActiveSessionStream,
  seedStreamingStateForActiveTurn,
} from "@/lib/chat-stream-resume";
import { client, formatError } from "@/lib/client";
import { createClientId } from "@/lib/client-id";
import {
  decodeModelSelection,
  effectiveProfileModelSelection,
  groupModelsByProvider,
  knownModelSelection,
  resolveModelThinkingSupport,
  resolveModelVisionSupport,
} from "@/lib/models";
import { SETUP_PATH } from "@/lib/navigation";
import {
  buildAutoEnableThinkingPayload,
  DEFAULT_THINKING_EFFORT,
  shouldAutoEnableThinking,
  shouldShowThinkingEffort,
} from "@/lib/thinking-settings";
import {
  appendFailedTurnIfNeeded,
  editedPromptText,
  findFailedRetryPrompt,
  findRetryPrompt,
  markStreamingTurnFailed,
  messagesWithoutFailedTurn,
  nextSuccessfulTurnAt,
  planPromptBranch,
} from "@/pages/chat/chat-page.shared";

interface SendMessageOptions {
  initialMessages?: ChatListItem[];
  questionnaireAnswers?: AgentQuestionAnswer[];
  sessionOverride?: RemoteChatSession;
}

interface QueuedSend {
  files: FileUIPart[];
  id: string;
  options: SendMessageOptions;
  text: string;
}

function useChatComposerDraft({
  userId,
  orgId,
  profileId,
  routeSession,
  search,
}: {
  userId?: string;
  orgId?: string;
  profileId: string;
  routeSession: ReturnType<typeof parseChatRouteParams>;
  search: string;
}) {
  const composerDraftKey = chatComposerDraftKey(
    userId,
    orgId,
    readRequestedProfileFromNewChatSearch(search) ??
      routeSession?.profileId ??
      profileId,
    routeSession?.sessionId ?? null
  );
  const [composerEntry, setComposerEntry] = useState(() => ({
    initialInput: readComposerDraft(composerDraftKey),
    revision: 0,
    scopeKey: composerDraftKey,
  }));
  if (composerEntry.scopeKey !== composerDraftKey) {
    setComposerEntry({
      initialInput: readComposerDraft(composerDraftKey),
      revision: 0,
      scopeKey: composerDraftKey,
    });
  }
  return { composerDraftKey, composerEntry, setComposerEntry };
}

export function useChatPage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const routeSession = useMemo(() => parseChatRouteParams(params), [params]);
  const { health, models } = useAppContext();
  const { user, activeOrg } = useAuth();
  const canManageInstallSettings = user?.isPlatformAdmin === true;
  const {
    profileId: storeProfileId,
    setProfileId,
    syncForOrg,
  } = useActiveChatProfile();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const profileId =
    storeProfileId ??
    readInitialDraftChatProfileId({
      orgId: activeOrg?.id,
      routeProfileId: parseChatRouteParams(params)?.profileId,
      search: location.search,
    });
  const [session, setSession] = useState<RemoteChatSession | null>(null);
  const [sessionModel, setSessionModel] = useState<string | null>(null);
  const [sessionChannel, setSessionChannel] = useState<AgentChannel>("web");
  const [messages, setMessages] = useState<ChatListItem[]>([]);
  const [agentTodos, setAgentTodos] = useState<AgentTodo[]>([]);
  const [agentQuestionnaire, setAgentQuestionnaire] =
    useState<AgentQuestionnaire | null>(null);
  const [contextUsage, setContextUsage] = useState<ChatContextUsage | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [lastSuccessfulTurnAt, setLastSuccessfulTurnAt] = useState<
    number | null
  >(null);
  const [turnStartedAt, setTurnStartedAt] = useState<string | null>(null);
  const [branchingMessageId, setBranchingMessageId] = useState<string | null>(
    null
  );
  const [canStop, setCanStop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { composerDraftKey, composerEntry, setComposerEntry } =
    useChatComposerDraft({
      orgId: activeOrg?.id,
      profileId,
      routeSession,
      search: location.search,
      userId: user?.id,
    });
  const [queuedMessages, setQueuedMessages] = useState<QueuedComposerMessage[]>(
    []
  );
  const streamAbortRef = useRef<AbortController | null>(null);
  const messageQueueRef = useRef<QueuedSend[]>([]);
  const isSendingRef = useRef(false);
  const skipNextProfileSessionRef = useRef(false);
  const loadedRouteRef = useRef<string | null>(null);
  const profileIdRef = useRef(profileId);
  const busyRef = useRef(busy);
  const activeSessionIdRef = useRef<string | null>(session?.id ?? null);

  useEffect(() => {
    profileIdRef.current = profileId;
  }, [profileId]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const syncChatUrl = useCallback(
    (nextProfileId: string, sessionId: string) => {
      const routeKey = `${nextProfileId}:${sessionId}`;
      const targetPath = buildChatPath(nextProfileId, sessionId);
      loadedRouteRef.current = routeKey;
      if (location.pathname !== targetPath) {
        navigate(targetPath, { replace: true });
      }
    },
    [location.pathname, navigate]
  );

  const chatStatus = useMemo(
    () => deriveChatStatus(busy, error, messages),
    [busy, error, messages]
  );

  const showOfflineHint = health != null && !health.providerConfigured;
  const branchSessionMutation = useBranchSessionMutation();
  const updateSessionMutation = useUpdateSessionMutation();
  const { data: thinkingSettings, isLoading: thinkingSettingsLoading } =
    useThinkingSettings();
  const saveThinkingSettingsMutation = useSaveThinkingSettings();
  const thinkingAutoEnableRef = useRef(false);
  const activeProfileQuery = useProfileQuery(profileId || null);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId),
    [profiles, profileId]
  );
  const availableSkills = activeProfileQuery.data?.skills ?? [];

  const providerModelGroups = useMemo(
    () => groupModelsByProvider(models?.models ?? []),
    [models?.models]
  );
  const providerModelGroupsRef = useRef(providerModelGroups);

  useEffect(() => {
    providerModelGroupsRef.current = providerModelGroups;
  }, [providerModelGroups]);

  // A draft chat opens on the model the user picked last, not the profile
  // default. Read through a ref so the draft-entry callbacks stay stable.
  const restoreLastChatModel = useCallback(
    (nextProfileId: string) =>
      knownModelSelection(
        readLastChatModel(nextProfileId),
        providerModelGroupsRef.current
      ),
    []
  );

  const currentModelSelection = useMemo(
    () =>
      effectiveProfileModelSelection(
        sessionModel ?? activeProfile?.model,
        providerModelGroups
      ),
    [activeProfile?.model, providerModelGroups, sessionModel]
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

  const readOnlySession = isReadOnlySessionChannel(sessionChannel);
  const showThinking = shouldShowThinkingEffort(activeModelSupportsThinking);
  const thinkingEffortVisible =
    canManageInstallSettings &&
    shouldShowThinkingEffort(activeModelSupportsThinking);
  const thinkingEffort = thinkingSettings?.effort ?? DEFAULT_THINKING_EFFORT;
  const thinkingEffortDisabled =
    busy ||
    thinkingSettingsLoading ||
    saveThinkingSettingsMutation.isPending ||
    readOnlySession;

  const handleModelChange = useCallback(
    (selection: string) => {
      if (
        !(profileId && selection) ||
        busy ||
        updateSessionMutation.isPending ||
        readOnlySession
      ) {
        return;
      }
      const decoded = decodeModelSelection(selection);
      if (!decoded) {
        return;
      }

      const previousModel = sessionModel;
      const previousStoredModel = readLastChatModel(profileId);
      setSessionModel(selection);
      writeLastChatModel(profileId, selection);

      if (!session) {
        return;
      }

      const updatedSessionId = session.id;
      void updateSessionMutation
        .mutateAsync({
          channel: sessionChannel,
          input: { model: selection },
          profileId,
          sessionId: updatedSessionId,
        })
        .catch((err) => {
          if (activeSessionIdRef.current !== updatedSessionId) {
            return;
          }
          setSessionModel(previousModel);
          writeLastChatModel(profileId, previousStoredModel);
          setError(formatError(err));
        });
    },
    [
      busy,
      profileId,
      readOnlySession,
      session,
      sessionChannel,
      sessionModel,
      updateSessionMutation,
    ]
  );

  const enterDraftChat = useCallback(
    (nextProfileId: string) => {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      localStorage.removeItem(sessionStorageKey(nextProfileId));
      skipNextProfileSessionRef.current = true;
      loadedRouteRef.current = null;
      messageQueueRef.current = [];
      isSendingRef.current = false;
      activeSessionIdRef.current = null;
      setQueuedMessages([]);
      setSession(null);
      setSessionModel(restoreLastChatModel(nextProfileId));
      setSessionChannel("web");
      setMessages([]);
      setError(null);
      setAgentTodos([]);
      setAgentQuestionnaire(null);
      setContextUsage(null);
      // Session routes remount ChatPage on /chat — pass profile in the query so it survives.
      // The ?new=1 handler then replaces the URL with bare /chat.
      if (location.pathname !== buildChatBasePath()) {
        navigate(buildNewChatPath(nextProfileId), { replace: true });
      }
    },
    [location.pathname, navigate, restoreLastChatModel]
  );

  const loadProfiles = useCallback(async () => {
    try {
      const response = await client.listProfiles();
      setProfiles(response.profiles);
      if (response.profiles.length === 0) {
        return;
      }
      const resolved = syncForOrg({
        orgId: activeOrg?.id ?? null,
        preferredProfileId: routeSession?.profileId,
        profiles: response.profiles,
      });
      if (routeSession && resolved && routeSession.profileId !== resolved) {
        enterDraftChat(resolved);
      }
    } catch (err) {
      setError(formatError(err));
    }
  }, [activeOrg?.id, enterDraftChat, routeSession, syncForOrg]);

  const handleThinkingEffortChange = useCallback(
    (effort: ThinkingEffort) => {
      if (
        !(canManageInstallSettings && profileId) ||
        effort === thinkingEffort
      ) {
        return;
      }

      if (busy || saveThinkingSettingsMutation.isPending) {
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
    [
      canManageInstallSettings,
      profileId,
      thinkingEffort,
      busy,
      saveThinkingSettingsMutation,
    ]
  );

  useEffect(() => {
    if (
      !(
        canManageInstallSettings &&
        shouldAutoEnableThinking(
          thinkingSettings,
          activeModelSupportsThinking,
          busy,
          thinkingAutoEnableRef.current,
          {
            hasMessages: messages.length > 0,
            hasProfileId: Boolean(profileId),
            hasRouteSession: Boolean(routeSession),
            hasSession: Boolean(session),
          }
        )
      )
    ) {
      return;
    }

    let cancelled = false;
    thinkingAutoEnableRef.current = true;
    const startedProfileId = profileId;

    void saveThinkingSettingsMutation
      .mutateAsync(buildAutoEnableThinkingPayload(thinkingSettings!))
      .then(() => {
        if (cancelled) {
          return;
        }
        if (profileIdRef.current !== startedProfileId) {
          return;
        }
        if (busyRef.current || routeSession) {
          return;
        }
        if (activeModelSupportsThinking !== true) {
          return;
        }
        enterDraftChat(startedProfileId);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        thinkingAutoEnableRef.current = false;
        setError(formatError(err));
      });

    return () => {
      cancelled = true;
    };
  }, [
    thinkingSettings,
    canManageInstallSettings,
    activeModelSupportsThinking,
    busy,
    profileId,
    routeSession,
    session,
    messages.length,
    saveThinkingSettingsMutation,
    enterDraftChat,
  ]);

  const resumeSession = useCallback(
    async (nextProfileId: string, sessionId: string) => {
      activeSessionIdRef.current = sessionId;
      setBusy(true);
      setError(null);
      try {
        localStorage.setItem(sessionStorageKey(nextProfileId), sessionId);
        skipNextProfileSessionRef.current = nextProfileId !== profileId;
        const {
          channel,
          messages: storedMessages,
          messageMeta,
          model,
          todos,
          questionnaire,
          contextUsage: nextContextUsage,
        } = await client.getSessionMessages(sessionId);
        const nextSession = client.createChatSession(sessionId, channel);
        let listItems = chatMessagesToListItems(storedMessages, messageMeta);
        const storedFailedTurn =
          channel === "web" ? readFailedChatTurn(sessionId) : null;

        if (storedFailedTurn) {
          listItems = appendFailedTurnIfNeeded(listItems, storedFailedTurn);
        }

        setProfileId(nextProfileId);
        setSessionChannel(channel);
        setSession(nextSession);
        setSessionModel(model);
        setMessages(listItems);
        setAgentTodos(todos);
        setAgentQuestionnaire(questionnaire);
        setContextUsage(nextContextUsage ?? null);
        setError(null);
        syncChatUrl(nextProfileId, sessionId);

        if (channel === "web") {
          const status = await client.getSessionStatus(sessionId);

          if (status.active) {
            setTurnStartedAt(status.startedAt ?? new Date().toISOString());
            listItems = seedStreamingStateForActiveTurn(listItems);
            setMessages(listItems);

            const abortController = new AbortController();
            streamAbortRef.current = abortController;

            const { reconnected } = await reconnectActiveSessionStream({
              handlers: buildStreamHandlers(setMessages, {
                onContextUsage: setContextUsage,
                onQuestionnaireUpdated: setAgentQuestionnaire,
                onTodosUpdated: setAgentTodos,
              }),
              messages: listItems,
              sessionId,
              signal: abortController.signal,
            });

            const refreshed = await client.getSessionMessages(sessionId);
            let refreshedItems = chatMessagesToListItems(
              refreshed.messages,
              refreshed.messageMeta
            );
            const failedAfterReconnect = readFailedChatTurn(sessionId);

            if (failedAfterReconnect && !reconnected) {
              refreshedItems = appendFailedTurnIfNeeded(
                refreshedItems,
                failedAfterReconnect
              );
            } else if (reconnected) {
              clearFailedChatTurn(sessionId);
              setError(null);
            }

            setMessages(refreshedItems);
            setAgentTodos(refreshed.todos);
            setAgentQuestionnaire(refreshed.questionnaire);
            setContextUsage(refreshed.contextUsage ?? null);
            setSessionModel(refreshed.model);

            if (reconnected) {
              setLastSuccessfulTurnAt((previous) =>
                nextSuccessfulTurnAt(previous)
              );
            }
          }
        }
      } catch (err) {
        if (isAbortError(err)) {
          setMessages((current) => finalizeStreamingMessages(current));
          return;
        }

        setError(formatError(err));
      } finally {
        streamAbortRef.current = null;
        setBusy(false);
        setTurnStartedAt(null);
      }
    },
    [profileId, setProfileId, syncChatUrl]
  );

  const handleBranchMessage = useCallback(
    async (message: ChatListItem) => {
      if (!(session && profileId) || typeof message.historyIndex !== "number") {
        return;
      }
      setBranchingMessageId(message.id);
      setError(null);
      try {
        const result = await branchSessionMutation.mutateAsync({
          channel: "web",
          messageIndex: message.historyIndex,
          profileId,
          sessionId: session.id,
        });
        await resumeSession(profileId, result.sessionId);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setBranchingMessageId(null);
      }
    },
    [branchSessionMutation, profileId, resumeSession, session]
  );

  const handleProfileSwitch = useCallback(
    (nextProfileId: string) => {
      if (
        !nextProfileId ||
        nextProfileId === profileIdRef.current ||
        busyRef.current
      ) {
        return;
      }
      setProfileId(nextProfileId);
      enterDraftChat(nextProfileId);
    },
    [enterDraftChat, setProfileId]
  );

  // Layout effect so session is cleared before the syncChatUrl effect can
  // re-push the previous /chat/:profile/:session URL (first-click blink).
  useLayoutEffect(() => {
    if (searchParams.get("new") !== "1") {
      return;
    }
    const requestedProfile = searchParams.get("profile")?.trim() || null;
    const targetProfileId = requestedProfile || profileId;
    const targetDraftKey = chatComposerDraftKey(
      user?.id,
      activeOrg?.id,
      targetProfileId,
      null
    );
    if (!targetDraftKey) {
      return;
    }
    const inlineDraft = readRequestedDraftFromNewChatSearch(location.search);
    const draftKey = readRequestedDraftKeyFromNewChatSearch(location.search);
    const storedDraft = draftKey ? consumeStoredChatDraft(draftKey) : null;
    const requestedDraft = inlineDraft ?? storedDraft;

    try {
      localStorage.removeItem(sessionStorageKey(targetProfileId));
    } catch {
      // Starting a new chat must still work when browser storage is disabled.
    }
    skipNextProfileSessionRef.current = true;
    loadedRouteRef.current = null;
    messageQueueRef.current = [];
    isSendingRef.current = false;
    activeSessionIdRef.current = null;
    setQueuedMessages([]);
    setSession(null);
    setSessionModel(
      targetProfileId ? restoreLastChatModel(targetProfileId) : null
    );
    setSessionChannel("web");
    setMessages([]);
    setError(null);
    setAgentTodos([]);
    setAgentQuestionnaire(null);
    setContextUsage(null);

    if (requestedProfile && requestedProfile !== profileIdRef.current) {
      setProfileId(requestedProfile);
    }

    if (requestedDraft !== null) {
      storeComposerDraft(targetDraftKey, requestedDraft);
      setComposerEntry((current) => ({
        initialInput: requestedDraft,
        revision: current.revision + 1,
        scopeKey: targetDraftKey,
      }));
    }

    navigate(buildChatBasePath(), { replace: true });
  }, [
    searchParams,
    setComposerEntry,
    setProfileId,
    navigate,
    location.search,
    restoreLastChatModel,
    profileId,
    user?.id,
    activeOrg?.id,
  ]);

  useEffect(() => {
    if (!profileId || routeSession) {
      return;
    }
    if (skipNextProfileSessionRef.current) {
      skipNextProfileSessionRef.current = false;
      return;
    }
    enterDraftChat(profileId);
  }, [profileId, routeSession, enterDraftChat]);

  useEffect(() => {
    if (!routeSession) {
      return;
    }
    const routeKey = `${routeSession.profileId}:${routeSession.sessionId}`;
    if (loadedRouteRef.current === routeKey) {
      return;
    }
    loadedRouteRef.current = routeKey;
    skipNextProfileSessionRef.current = true;
    void resumeSession(routeSession.profileId, routeSession.sessionId);
  }, [routeSession, resumeSession]);

  useEffect(() => {
    if (!(session && profileId)) {
      return;
    }
    // Stale session state must never overwrite an intentional draft /chat URL.
    // send/resume call syncChatUrl explicitly when a session should be reflected.
    if (location.pathname === buildChatBasePath()) {
      return;
    }
    syncChatUrl(profileId, session.id);
  }, [session, profileId, syncChatUrl, location.pathname]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const stopStreaming = useCallback(() => {
    streamAbortRef.current?.abort();
  }, []);

  const executeSend = useCallback(
    async (
      text: string,
      files: FileUIPart[] = [],
      options: SendMessageOptions = {},
      queueItem?: QueuedSend
    ) => {
      isSendingRef.current = true;
      setBusy(true);
      setTurnStartedAt(new Date().toISOString());
      setError(null);

      const images = filePartsToImageAttachments(files);
      const documents = filePartsToDocumentAttachments(files);
      const displayDocuments = filePartsToDisplayDocuments(files);

      if (options.initialMessages) {
        setMessages(options.initialMessages);
        setAgentTodos([]);
        setAgentQuestionnaire(null);
      }

      setAgentQuestionnaire(null);

      const displayImages = images.map((image) => ({
        mediaType: image.mediaType,
        url: `data:${image.mediaType};base64,${image.data}`,
      }));
      const useImageAttachments = activeModelSupportsVision === false;
      const outgoingOptions = {
        imageAttachments:
          useImageAttachments && displayImages.length > 0
            ? displayImages
            : undefined,
        questionnaireAnswers: options.questionnaireAnswers,
        thinkingEnabled: showThinking,
      };

      appendOutgoingMessages(
        setMessages,
        text,
        useImageAttachments ? [] : displayImages,
        displayDocuments.length > 0 ? displayDocuments : undefined,
        outgoingOptions
      );

      let activeSession = options.sessionOverride ?? session;
      let shouldDrainQueue = true;

      if (!activeSession) {
        try {
          activeSession = await client.createSession("web", {
            model: sessionModel ?? undefined,
            profileId,
          });
          localStorage.setItem(sessionStorageKey(profileId), activeSession.id);
          activeSessionIdRef.current = activeSession.id;
          setSessionChannel("web");
          setSession(activeSession);
          syncChatUrl(profileId, activeSession.id);
        } catch (err) {
          setError(formatError(err));
          shouldDrainQueue = false;
          setMessages((current) => current.slice(0, -2));
          if (queueItem) {
            messageQueueRef.current.unshift(queueItem);
            setQueuedMessages((current) => [
              {
                attachmentCount: queueItem.files.length,
                id: queueItem.id,
                text: queueItem.text,
              },
              ...current,
            ]);
          }
          return;
        }
      }

      const abortController = new AbortController();
      streamAbortRef.current = abortController;
      setCanStop(true);

      try {
        await activeSession.sendStream(
          {
            documents: documents.length > 0 ? documents : undefined,
            images: images.length > 0 ? images : undefined,
            message: text,
          },
          buildStreamHandlers(setMessages, {
            onContextUsage: setContextUsage,
            onQuestionnaireUpdated: setAgentQuestionnaire,
            onTodosUpdated: setAgentTodos,
          }),
          { signal: abortController.signal }
        );

        const {
          messages: storedMessages,
          messageMeta,
          todos,
          questionnaire,
          contextUsage: nextContextUsage,
          model: nextSessionModel,
        } = await client.getSessionMessages(activeSession.id);
        clearFailedChatTurn(activeSession.id);
        setMessages(chatMessagesToListItems(storedMessages, messageMeta));
        setAgentTodos(todos);
        setAgentQuestionnaire(questionnaire);
        setContextUsage(nextContextUsage ?? null);
        setSessionModel(nextSessionModel);
        setLastSuccessfulTurnAt((previous) => nextSuccessfulTurnAt(previous));
      } catch (err) {
        if (isAbortError(err)) {
          setMessages((current) => finalizeStreamingMessages(current));
          return;
        }

        const message = formatError(err);

        if (isActiveTurnConflictError(message) && activeSession) {
          setError("The agent is still responding to your last message.");
          return;
        }

        if (message.includes("Session not found") && profileId) {
          try {
            const nextSession = await client.createSession("web", {
              model: sessionModel ?? undefined,
              profileId,
            });
            localStorage.setItem(sessionStorageKey(profileId), nextSession.id);
            activeSessionIdRef.current = nextSession.id;
            setSessionChannel("web");
            setSession(nextSession);
            setError(
              "Chat session expired. Started a new session — please send again."
            );
            setMessages((current) =>
              current.filter((message) => !message.streaming)
            );
            setAgentQuestionnaire(null);
            return;
          } catch (retryErr) {
            setError(formatError(retryErr));
            setMessages((current) =>
              current.filter((message) => !message.streaming)
            );
            return;
          }
        }

        // Turn failures live in the Failed bubble; composer error stays for
        // non-turn issues (attachments, session expired, validation, etc.).
        setError(null);
        if (activeSession && text.trim()) {
          storeFailedChatTurn(activeSession.id, { error: message, text });
        }
        setMessages((current) => markStreamingTurnFailed(current, message));
      } finally {
        streamAbortRef.current = null;
        setCanStop(false);
        setBusy(false);
        setTurnStartedAt(null);

        const next = shouldDrainQueue ? messageQueueRef.current.shift() : null;
        if (next) {
          setQueuedMessages((current) =>
            current.filter((item) => item.id !== next.id)
          );
          void executeSend(next.text, next.files, next.options, next);
        } else {
          isSendingRef.current = false;
        }
      }
    },
    [
      session,
      profileId,
      syncChatUrl,
      showThinking,
      activeModelSupportsVision,
      sessionModel,
    ]
  );

  const sendMessage = useCallback(
    async (
      text: string,
      files: FileUIPart[] = [],
      options: SendMessageOptions = {}
    ) => {
      if (readOnlySession) {
        return;
      }

      const images = filePartsToImageAttachments(files);
      const documents = filePartsToDocumentAttachments(files);

      if (
        (!text.trim() && images.length === 0 && documents.length === 0) ||
        !profileId
      ) {
        return;
      }

      if (isSendingRef.current) {
        const queuedItem: QueuedSend = {
          files,
          id: createClientId(),
          options,
          text,
        };
        messageQueueRef.current.push(queuedItem);
        setQueuedMessages((current) => [
          ...current,
          {
            attachmentCount: queuedItem.files.length,
            id: queuedItem.id,
            text: queuedItem.text,
          },
        ]);
        return;
      }

      await executeSend(text, files, options);
    },
    [executeSend, profileId, readOnlySession]
  );

  /**
   * Branch the session at the checkpoint before `prompt`, then send `text` into
   * the branch.
   */
  const branchAndSendPrompt = useCallback(
    async (prompt: ChatListItem, text: string, anchorId: string) => {
      // Branch before send, so a read-only session must bail here: sendMessage
      // no-ops on those and would strand the user in an empty branch.
      if (!profileId || readOnlySession) {
        return;
      }

      const plan = planPromptBranch(messages, prompt);

      if (plan && !session) {
        setError(
          "Chat session is unavailable. Please send a new message instead."
        );
        return;
      }

      setBranchingMessageId(anchorId);
      setError(null);

      try {
        let retrySession: RemoteChatSession;
        let initialMessages: ChatListItem[] = [];

        if (plan && session) {
          const result = await branchSessionMutation.mutateAsync({
            channel: "web",
            messageIndex: plan.messageIndex,
            profileId,
            sessionId: session.id,
          });
          retrySession = client.createChatSession(result.sessionId, "web");
          initialMessages = plan.initialMessages;
        } else {
          retrySession = await client.createSession("web", {
            model: sessionModel ?? undefined,
            profileId,
          });
        }

        localStorage.setItem(sessionStorageKey(profileId), retrySession.id);
        setSession(retrySession);
        syncChatUrl(profileId, retrySession.id);

        await sendMessage(text, [], {
          initialMessages,
          sessionOverride: retrySession,
        });
      } catch (err) {
        setError(formatError(err));
      } finally {
        setBranchingMessageId(null);
      }
    },
    [
      branchSessionMutation,
      messages,
      profileId,
      readOnlySession,
      sendMessage,
      session,
      sessionModel,
      syncChatUrl,
    ]
  );

  const handleTryAgainMessage = useCallback(
    async (message: ChatListItem) => {
      if (busy || !profileId) {
        return;
      }

      if (message.failed) {
        const prompt = findFailedRetryPrompt(messages, message);

        if (!prompt?.content.trim()) {
          setError("Could not find a prompt to retry.");
          return;
        }

        if (prompt.images?.length || prompt.documents?.length) {
          setError("Retry is available for text-only prompts.");
          return;
        }

        setBranchingMessageId(message.id);
        setError(null);

        try {
          if (session) {
            clearFailedChatTurn(session.id);
          }

          await sendMessage(prompt.content, [], {
            initialMessages: messagesWithoutFailedTurn(messages, message),
            sessionOverride: session ?? undefined,
          });
        } catch (err) {
          setError(formatError(err));
        } finally {
          setBranchingMessageId(null);
        }

        return;
      }

      const prompt = findRetryPrompt(messages, message);

      if (!prompt?.content.trim()) {
        setError("Could not find a prompt to try again.");
        return;
      }

      if (prompt.images?.length || prompt.documents?.length) {
        setError("Try again is available for text-only prompts.");
        return;
      }

      await branchAndSendPrompt(prompt, prompt.content, message.id);
    },
    [branchAndSendPrompt, busy, messages, profileId, sendMessage, session]
  );

  /** Resend an edited user message; the reply is regenerated from it. */
  const handleEditMessage = useCallback(
    async (message: ChatListItem, text: string) => {
      if (busy || !profileId) {
        return;
      }

      const nextText = editedPromptText(message, text);

      if (nextText === null) {
        return;
      }

      // The list only offers Edit on eligible rows. The handler repeats the
      // check so an attachment or an unsent turn can never reach the branch.
      if (!isEditableUserMessage(message)) {
        setError("Editing is available for text-only messages already sent.");
        return;
      }

      await branchAndSendPrompt(message, nextText, message.id);
    },
    [branchAndSendPrompt, busy, profileId]
  );

  const isEmptyState = messages.length === 0 && !busy;
  const composerDisabled =
    !profileId || readOnlySession || updateSessionMutation.isPending;

  return {
    activeModelSupportsVision,
    activeProfile,
    agentQuestionnaire,
    agentTodos,
    availableSkills,
    branchingMessageId,
    busy,
    canStop,
    chatStatus,
    composerDisabled,
    composerDraftKey,
    composerEntry,
    contextUsage: isEmptyState ? null : contextUsage,
    currentModelSelection,
    error,
    handleBranchMessage,
    handleEditMessage,
    handleModelChange,
    handleProfileSwitch,
    handleThinkingEffortChange,
    handleTryAgainMessage,
    health,
    isEmptyState,
    lastSuccessfulTurnAt,
    messages,
    navigateSetup: () => navigate(SETUP_PATH),
    profileId,
    profiles,
    providerModelGroups,
    queuedMessages,
    readOnlySession,
    renderModelLabel,
    sendMessage,
    session,
    sessionChannel,
    showOfflineHint,
    showThinking,
    stopStreaming,
    thinkingEffort,
    thinkingEffortDisabled,
    thinkingEffortVisible,
    turnStartedAt,
  };
}

export type ChatPageState = ReturnType<typeof useChatPage>;
