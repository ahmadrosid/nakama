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
  chatMessagesToListItems,
  clearFailedChatTurn,
  consumeStoredChatDraft,
  isReadOnlySessionChannel,
  parseChatRouteParams,
  pickKnownProfileId,
  readFailedChatTurn,
  readInitialDraftChatProfileId,
  readRequestedDraftFromNewChatSearch,
  readRequestedDraftKeyFromNewChatSearch,
  readStoredActiveChatProfileId,
  resolveDefaultProfileId,
  sessionStorageKey,
  storeFailedChatTurn,
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
  findFailedRetryPrompt,
  findRetryCheckpoint,
  findRetryPrompt,
  markStreamingTurnFailed,
  messagesWithoutFailedTurn,
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

export function useChatPage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const routeSession = useMemo(() => parseChatRouteParams(params), [params]);
  const { health, models } = useAppContext();
  const {
    profileId: liveChatProfileId,
    setProfileId: setLiveChatProfileId,
    registerChatProfileSwitchHandler,
  } = useActiveChatProfile();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [profileId, setProfileId] = useState(() =>
    readInitialDraftChatProfileId({
      routeProfileId: parseChatRouteParams(params)?.profileId,
      search: location.search,
    })
  );
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
  const [composerDraft, setComposerDraft] = useState("");
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

  // Composer / in-page switches update profileId first; push to shared context.
  useEffect(() => {
    if (!profileId || profileId === liveChatProfileId) {
      return;
    }
    setLiveChatProfileId(profileId);
  }, [profileId, liveChatProfileId, setLiveChatProfileId]);

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
  const thinkingEffortVisible = shouldShowThinkingEffort(
    activeModelSupportsThinking
  );
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
      setSessionModel(selection);

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

  const loadProfiles = useCallback(async () => {
    try {
      const response = await client.listProfiles();
      setProfiles(response.profiles);
      if (!routeSession && response.profiles.length > 0) {
        setProfileId((current) => {
          const resolved = pickKnownProfileId(
            response.profiles,
            current,
            readStoredActiveChatProfileId()
          );
          if (resolved) {
            return resolved;
          }
          return resolveDefaultProfileId(response.profiles) ?? "";
        });
      }
    } catch (err) {
      setError(formatError(err));
    }
  }, [routeSession]);

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
      setSessionModel(null);
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
    [location.pathname, navigate]
  );

  const handleThinkingEffortChange = useCallback(
    (effort: ThinkingEffort) => {
      if (!profileId || effort === thinkingEffort) {
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
    [profileId, thinkingEffort, busy, saveThinkingSettingsMutation]
  );

  useEffect(() => {
    if (
      !shouldAutoEnableThinking(
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
              setLastSuccessfulTurnAt(Date.now());
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
    [profileId, syncChatUrl]
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
    [enterDraftChat]
  );

  useEffect(
    () =>
      registerChatProfileSwitchHandler((nextProfileId) => {
        if (
          !nextProfileId ||
          nextProfileId === profileIdRef.current ||
          busyRef.current
        ) {
          return;
        }
        setProfileId(nextProfileId);
        enterDraftChat(nextProfileId);
      }),
    [registerChatProfileSwitchHandler, enterDraftChat]
  );

  // Layout effect so session is cleared before the syncChatUrl effect can
  // re-push the previous /chat/:profile/:session URL (first-click blink).
  useLayoutEffect(() => {
    if (searchParams.get("new") !== "1") {
      return;
    }
    const requestedProfile = searchParams.get("profile")?.trim() || null;
    const inlineDraft = readRequestedDraftFromNewChatSearch(location.search);
    const draftKey = readRequestedDraftKeyFromNewChatSearch(location.search);
    const storedDraft = draftKey ? consumeStoredChatDraft(draftKey) : null;
    const requestedDraft = inlineDraft ?? storedDraft;
    const targetProfileId = requestedProfile || profileIdRef.current;

    if (targetProfileId) {
      localStorage.removeItem(sessionStorageKey(targetProfileId));
    }
    skipNextProfileSessionRef.current = true;
    loadedRouteRef.current = null;
    messageQueueRef.current = [];
    isSendingRef.current = false;
    activeSessionIdRef.current = null;
    setQueuedMessages([]);
    setSession(null);
    setSessionModel(null);
    setSessionChannel("web");
    setMessages([]);
    setError(null);
    setAgentTodos([]);
    setAgentQuestionnaire(null);
    setContextUsage(null);

    if (requestedProfile && requestedProfile !== profileIdRef.current) {
      setProfileId(requestedProfile);
    }

    if (requestedDraft) {
      setComposerDraft(requestedDraft);
    }

    navigate(buildChatBasePath(), { replace: true });
  }, [searchParams, navigate, location.search]);

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
        setLastSuccessfulTurnAt(Date.now());
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

      const checkpoint = findRetryCheckpoint(messages, prompt);

      if (checkpoint && !session) {
        setError(
          "Chat session is unavailable. Please send a new message instead."
        );
        return;
      }

      setBranchingMessageId(message.id);
      setError(null);

      try {
        let retrySession: RemoteChatSession;
        let initialMessages: ChatListItem[] = [];

        if (checkpoint && session) {
          const result = await branchSessionMutation.mutateAsync({
            channel: "web",
            messageIndex: checkpoint.historyIndex!,
            profileId,
            sessionId: session.id,
          });
          retrySession = client.createChatSession(result.sessionId, "web");
          initialMessages = messages.filter(
            (item) =>
              typeof item.historyIndex === "number" &&
              item.historyIndex <= checkpoint.historyIndex!
          );
        } else {
          retrySession = await client.createSession("web", {
            model: sessionModel ?? undefined,
            profileId,
          });
        }

        localStorage.setItem(sessionStorageKey(profileId), retrySession.id);
        setSession(retrySession);
        syncChatUrl(profileId, retrySession.id);

        await sendMessage(prompt.content, [], {
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
      busy,
      messages,
      profileId,
      sendMessage,
      session,
      sessionModel,
      syncChatUrl,
    ]
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
    composerDraft,
    contextUsage: isEmptyState ? null : contextUsage,
    currentModelSelection,
    error,
    handleBranchMessage,
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
    setComposerDraft,
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
