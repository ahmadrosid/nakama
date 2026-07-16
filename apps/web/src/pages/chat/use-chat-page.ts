import type {
  AgentChannel,
  AgentQuestionAnswer,
  AgentQuestionnaire,
  AgentTodo,
  ProfileSummary,
} from "@nakama/core/contract";
import type { FileUIPart } from "ai";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { RemoteChatSession } from "@nakama/client";
import type { QueuedComposerMessage } from "@/components/chat/ChatMessageQueuePanel";
import { useAppContext } from "@/context/use-app-context";
import { useProfileQuery } from "@/hooks/use-app-queries";
import { useBranchSessionMutation, useUpdateProfileMutation } from "@/hooks/use-resource-mutations";
import {
  filePartsToDisplayDocuments,
  filePartsToDocumentAttachments,
  filePartsToImageAttachments,
} from "@/lib/chat-images";
import {
  buildChatBasePath,
  buildChatPath,
  chatMessagesToListItems,
  isReadOnlySessionChannel,
  parseChatRouteParams,
  readRequestedDraftFromNewChatSearch,
  readRequestedDraftKeyFromNewChatSearch,
  consumeStoredChatDraft,
  readRequestedProfileFromNewChatSearch,
  sessionStorageKey,
  type ChatListItem,
} from "@/lib/chat-history";
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
  groupModelsByProvider,
  resolveModelThinkingSupport,
  resolveModelVisionSupport,
} from "@/lib/models";
import { SETUP_PATH } from "@/lib/navigation";
import { findRetryCheckpoint, findRetryPrompt } from "@/pages/chat/chat-page.shared";

interface SendMessageOptions {
  sessionOverride?: RemoteChatSession;
  initialMessages?: ChatListItem[];
  questionnaireAnswers?: AgentQuestionAnswer[];
}

interface QueuedSend {
  id: string;
  text: string;
  files: FileUIPart[];
  options: SendMessageOptions;
}

export function useChatPage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeSession = useMemo(() => parseChatRouteParams(params), [params]);
  const { health, models } = useAppContext();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [profileId, setProfileId] = useState(
    () => readRequestedProfileFromNewChatSearch(location.search) ?? "",
  );
  const [session, setSession] = useState<RemoteChatSession | null>(null);
  const [sessionChannel, setSessionChannel] = useState<AgentChannel>("web");
  const [messages, setMessages] = useState<ChatListItem[]>([]);
  const [agentTodos, setAgentTodos] = useState<AgentTodo[]>([]);
  const [agentQuestionnaire, setAgentQuestionnaire] = useState<AgentQuestionnaire | null>(null);
  const [busy, setBusy] = useState(false);
  const [branchingMessageId, setBranchingMessageId] = useState<string | null>(null);
  const [canStop, setCanStop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composerDraft, setComposerDraft] = useState("");
  const [queuedMessages, setQueuedMessages] = useState<QueuedComposerMessage[]>([]);
  const streamAbortRef = useRef<AbortController | null>(null);
  const messageQueueRef = useRef<QueuedSend[]>([]);
  const isSendingRef = useRef(false);
  const skipNextProfileSessionRef = useRef(false);
  const loadedRouteRef = useRef<string | null>(null);
  const profileSwitchInFlightRef = useRef(false);
  const profileIdRef = useRef(profileId);

  useEffect(() => {
    profileIdRef.current = profileId;
  }, [profileId]);

  const syncChatUrl = useCallback(
    (nextProfileId: string, sessionId: string) => {
      const routeKey = `${nextProfileId}:${sessionId}`;
      const targetPath = buildChatPath(nextProfileId, sessionId);
      loadedRouteRef.current = routeKey;
      if (location.pathname !== targetPath) {
        navigate(targetPath, { replace: true });
      }
    },
    [location.pathname, navigate],
  );

  const chatStatus = useMemo(
    () => deriveChatStatus(busy, error, messages),
    [busy, error, messages],
  );

  const showOfflineHint = health != null && !health.providerConfigured;
  const branchSessionMutation = useBranchSessionMutation();
  const updateProfileMutation = useUpdateProfileMutation();
  const activeProfileQuery = useProfileQuery(profileId || null);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId),
    [profiles, profileId],
  );
  const availableSkills = activeProfileQuery.data?.skills ?? [];

  const providerModelGroups = useMemo(
    () => groupModelsByProvider(models?.models ?? []),
    [models?.models],
  );

  const currentModelSelection = useMemo(
    () => effectiveProfileModelSelection(activeProfile?.model, providerModelGroups),
    [activeProfile?.model, providerModelGroups],
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
        (entry) => entry.providerId === decoded.providerId,
      );
      return (
        group?.models.find((model) => model.id === decoded.modelId)?.name ??
        decoded.modelId
      );
    },
    [providerModelGroups],
  );

  const activeModelSupportsThinking = useMemo(
    () => resolveModelThinkingSupport(currentModelSelection, providerModelGroups),
    [currentModelSelection, providerModelGroups],
  );

  const activeModelSupportsVision = useMemo(
    () => resolveModelVisionSupport(currentModelSelection, providerModelGroups),
    [currentModelSelection, providerModelGroups],
  );

  const showThinking = activeModelSupportsThinking !== false;
  const readOnlySession = isReadOnlySessionChannel(sessionChannel);

  const handleModelChange = useCallback(
    (selection: string) => {
      if (!profileId || !selection) {
        return;
      }
      const decoded = decodeModelSelection(selection);
      if (!decoded) {
        return;
      }
      void updateProfileMutation
        .mutateAsync({ profileId, input: { model: selection } })
        .then(() => {
          setProfiles((current) =>
            current.map((profile) =>
              profile.id === profileId ? { ...profile, model: selection } : profile,
            ),
          );
        })
        .catch((err) => {
          setError(formatError(err));
        });
    },
    [profileId, updateProfileMutation],
  );

  const loadProfiles = useCallback(async () => {
    try {
      const response = await client.listProfiles();
      setProfiles(response.profiles);
      if (!routeSession && response.profiles.length > 0) {
        setProfileId((current) => {
          if (current) {
            return current;
          }
          const defaultProfile =
            response.profiles.find((profile) => profile.id === "default") ??
            response.profiles[0]!;
          return defaultProfile.id;
        });
      }
    } catch (err) {
      setError(formatError(err));
    }
  }, [routeSession]);

  const enterDraftChat = useCallback(
    (nextProfileId: string) => {
      localStorage.removeItem(sessionStorageKey(nextProfileId));
      skipNextProfileSessionRef.current = true;
      loadedRouteRef.current = null;
      messageQueueRef.current = [];
      isSendingRef.current = false;
      setQueuedMessages([]);
      setSession(null);
      setSessionChannel("web");
      setMessages([]);
      setError(null);
      setAgentTodos([]);
      setAgentQuestionnaire(null);
      if (location.pathname !== buildChatBasePath()) {
        navigate(buildChatBasePath(), { replace: true });
      }
    },
    [location.pathname, navigate],
  );

  const resumeSession = useCallback(
    async (nextProfileId: string, sessionId: string) => {
      setBusy(true);
      setError(null);
      try {
        localStorage.setItem(sessionStorageKey(nextProfileId), sessionId);
        skipNextProfileSessionRef.current = nextProfileId !== profileId;
        const {
          channel,
          messages: storedMessages,
          messageMeta,
          todos,
          questionnaire,
        } = await client.getSessionMessages(sessionId);
        const nextSession = client.createChatSession(sessionId, channel);
        setProfileId(nextProfileId);
        setSessionChannel(channel);
        setSession(nextSession);
        setMessages(chatMessagesToListItems(storedMessages, messageMeta));
        setAgentTodos(todos);
        setAgentQuestionnaire(questionnaire);
        syncChatUrl(nextProfileId, sessionId);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setBusy(false);
      }
    },
    [profileId, syncChatUrl],
  );

  const handleBranchMessage = useCallback(
    async (message: ChatListItem) => {
      if (!session || !profileId || typeof message.historyIndex !== "number") {
        return;
      }
      setBranchingMessageId(message.id);
      setError(null);
      try {
        const result = await branchSessionMutation.mutateAsync({
          profileId,
          sessionId: session.id,
          messageIndex: message.historyIndex,
          channel: "web",
        });
        await resumeSession(profileId, result.sessionId);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setBranchingMessageId(null);
      }
    },
    [branchSessionMutation, profileId, resumeSession, session],
  );

  const handleProfileSwitch = useCallback(
    async (nextProfileId: string) => {
      if (!nextProfileId || nextProfileId === profileId || busy) {
        return;
      }
      profileSwitchInFlightRef.current = true;
      setProfileId(nextProfileId);
      enterDraftChat(nextProfileId);
      profileSwitchInFlightRef.current = false;
    },
    [profileId, busy, enterDraftChat],
  );

  useEffect(() => {
    if (searchParams.get("new") !== "1") {
      return;
    }
    const requestedProfile = searchParams.get("profile")?.trim() || null;
    const inlineDraft = readRequestedDraftFromNewChatSearch(location.search);
    const draftKey = readRequestedDraftKeyFromNewChatSearch(location.search);
    const storedDraft = draftKey ? consumeStoredChatDraft(draftKey) : null;
    const requestedDraft = inlineDraft ?? storedDraft;
    setSearchParams({}, { replace: true });
    const targetProfileId = requestedProfile || profileIdRef.current;
    if (!targetProfileId) {
      return;
    }

    skipNextProfileSessionRef.current = true;

    if (requestedProfile && requestedProfile !== profileIdRef.current) {
      setProfileId(requestedProfile);
    }

    if (requestedDraft) {
      setComposerDraft(requestedDraft);
    }

    enterDraftChat(targetProfileId);
  }, [searchParams, setSearchParams, enterDraftChat, location.search]);

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
    if (!routeSession || profileSwitchInFlightRef.current) {
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
    if (!session || !profileId || profileSwitchInFlightRef.current) {
      return;
    }
    syncChatUrl(profileId, session.id);
  }, [session, profileId, syncChatUrl]);

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
      queueItem?: QueuedSend,
    ) => {
      isSendingRef.current = true;
      setBusy(true);
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
        thinkingEnabled: showThinking,
        imageAttachments:
          useImageAttachments && displayImages.length > 0 ? displayImages : undefined,
        questionnaireAnswers: options.questionnaireAnswers,
      };

      appendOutgoingMessages(
        setMessages,
        text,
        useImageAttachments ? [] : displayImages,
        displayDocuments.length > 0 ? displayDocuments : undefined,
        outgoingOptions,
      );

      let activeSession = options.sessionOverride ?? session;
      let shouldDrainQueue = true;

      if (!activeSession) {
        try {
          activeSession = await client.createSession("web", { profileId });
          localStorage.setItem(sessionStorageKey(profileId), activeSession.id);
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
                id: queueItem.id,
                text: queueItem.text,
                attachmentCount: queueItem.files.length,
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
            message: text,
            images: images.length > 0 ? images : undefined,
            documents: documents.length > 0 ? documents : undefined,
          },
          buildStreamHandlers(setMessages, {
            onTodosUpdated: setAgentTodos,
            onQuestionnaireUpdated: setAgentQuestionnaire,
          }),
          { signal: abortController.signal },
        );

        const {
          messages: storedMessages,
          messageMeta,
          todos,
          questionnaire,
        } = await client.getSessionMessages(activeSession.id);
        setMessages(chatMessagesToListItems(storedMessages, messageMeta));
        setAgentTodos(todos);
        setAgentQuestionnaire(questionnaire);
      } catch (err) {
        if (isAbortError(err)) {
          setMessages((current) => finalizeStreamingMessages(current));
          return;
        }

        const message = formatError(err);

        if (message.includes("Session not found") && profileId) {
          try {
            const nextSession = await client.createSession("web", { profileId });
            localStorage.setItem(sessionStorageKey(profileId), nextSession.id);
            setSessionChannel("web");
            setSession(nextSession);
            setError("Chat session expired. Started a new session — please send again.");
            setMessages((current) => current.filter((message) => !message.streaming));
            setAgentQuestionnaire(null);
            return;
          } catch (retryErr) {
            setError(formatError(retryErr));
            setMessages((current) => current.filter((message) => !message.streaming));
            return;
          }
        }

        setError(message);
        setMessages((current) => current.filter((message) => !message.streaming));
      } finally {
        streamAbortRef.current = null;
        setCanStop(false);
        setBusy(false);

        const next = shouldDrainQueue ? messageQueueRef.current.shift() : null;
        if (next) {
          setQueuedMessages((current) => current.filter((item) => item.id !== next.id));
          void executeSend(next.text, next.files, next.options, next);
        } else {
          isSendingRef.current = false;
        }
      }
    },
    [session, profileId, syncChatUrl, showThinking, activeModelSupportsVision],
  );

  const sendMessage = useCallback(
    async (text: string, files: FileUIPart[] = [], options: SendMessageOptions = {}) => {
      if (readOnlySession) {
        return;
      }

      const images = filePartsToImageAttachments(files);
      const documents = filePartsToDocumentAttachments(files);

      if ((!text.trim() && images.length === 0 && documents.length === 0) || !profileId) {
        return;
      }

      if (isSendingRef.current) {
        const queuedItem: QueuedSend = {
          id: nanoid(),
          text,
          files,
          options,
        };
        messageQueueRef.current.push(queuedItem);
        setQueuedMessages((current) => [
          ...current,
          {
            id: queuedItem.id,
            text: queuedItem.text,
            attachmentCount: queuedItem.files.length,
          },
        ]);
        return;
      }

      await executeSend(text, files, options);
    },
    [executeSend, profileId, readOnlySession],
  );

  const handleTryAgainMessage = useCallback(
    async (message: ChatListItem) => {
      if (busy || !profileId) {
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
        setError("Chat session is unavailable. Please send a new message instead.");
        return;
      }

      setBranchingMessageId(message.id);
      setError(null);

      try {
        let retrySession: RemoteChatSession;
        let initialMessages: ChatListItem[] = [];

        if (checkpoint && session) {
          const result = await branchSessionMutation.mutateAsync({
            profileId,
            sessionId: session.id,
            messageIndex: checkpoint.historyIndex!,
            channel: "web",
          });
          retrySession = client.createChatSession(result.sessionId, "web");
          initialMessages = messages.filter(
            (item) =>
              typeof item.historyIndex === "number" &&
              item.historyIndex <= checkpoint.historyIndex!,
          );
        } else {
          retrySession = await client.createSession("web", { profileId });
        }

        localStorage.setItem(sessionStorageKey(profileId), retrySession.id);
        setSession(retrySession);
        syncChatUrl(profileId, retrySession.id);

        await sendMessage(prompt.content, [], {
          sessionOverride: retrySession,
          initialMessages,
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
      syncChatUrl,
    ],
  );

  const isEmptyState = messages.length === 0 && !busy;
  const composerDisabled = !profileId || readOnlySession;

  return {
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
    navigateSetup: () => navigate(SETUP_PATH),
    agentTodos,
    agentQuestionnaire,
  };
}

export type ChatPageState = ReturnType<typeof useChatPage>;
