import type { AgentTodo, ProfileSummary } from "@tinyclaw/core/contract";
import type { FileUIPart } from "ai";
import { MessageCircleIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { RemoteChatSession } from "@tinyclaw/client";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { useAppContext } from "@/context/app-context";
import { useBranchSessionMutation, useUpdateProfileMutation } from "@/hooks/use-resource-mutations";
import { useThinkingSettings } from "@/hooks/use-thinking-settings";
import { filePartsToDocumentAttachments, filePartsToImageAttachments } from "@/lib/chat-images";
import {
  buildChatBasePath,
  buildChatPath,
  chatMessagesToListItems,
  parseChatRouteParams,
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
  INHERIT_MODEL_VALUE,
  profileModelLabel,
} from "@/lib/models";
import { SETUP_PATH } from "@/lib/navigation";

interface SendMessageOptions {
  sessionOverride?: RemoteChatSession;
  initialMessages?: ChatListItem[];
}

export function ChatPage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeSession = useMemo(() => parseChatRouteParams(params), [params]);
  const { health, models } = useAppContext();
  const { data: thinkingSettings } = useThinkingSettings();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [profileId, setProfileId] = useState(
    () => readRequestedProfileFromNewChatSearch(location.search) ?? "",
  );
  const [session, setSession] = useState<RemoteChatSession | null>(null);
  const [messages, setMessages] = useState<ChatListItem[]>([]);
  const [agentTodos, setAgentTodos] = useState<AgentTodo[]>([]);
  const [busy, setBusy] = useState(false);
  const [branchingMessageId, setBranchingMessageId] = useState<string | null>(null);
  const [canStop, setCanStop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const skipNextProfileSessionRef = useRef(false);
  const loadedRouteRef = useRef<string | null>(null);
  const profileSwitchInFlightRef = useRef(false);
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

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId),
    [profiles, profileId],
  );

  const providerModelGroups = useMemo(
    () => groupModelsByProvider(models?.models ?? []),
    [models?.models],
  );

  const currentModelSelection = useMemo(
    () =>
      effectiveProfileModelSelection(
        activeProfile?.model,
        models?.currentProviderId,
        models?.currentModel,
        providerModelGroups,
      ),
    [
      activeProfile?.model,
      models?.currentProviderId,
      models?.currentModel,
      providerModelGroups,
    ],
  );

  const renderModelLabel = useCallback(
    (selection: string | null) => {
      if (!selection) {
        return null;
      }

      if (selection === INHERIT_MODEL_VALUE) {
        return profileModelLabel(null, providerModelGroups, models?.currentModel);
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
    [models?.currentModel, providerModelGroups],
  );

  const handleModelChange = useCallback(
    (selection: string) => {
      if (!profileId) {
        return;
      }

      if (selection === INHERIT_MODEL_VALUE) {
        void updateProfileMutation
          .mutateAsync({
            profileId,
            input: { model: null },
          })
          .then(() => {
            setProfiles((current) =>
              current.map((profile) =>
                profile.id === profileId ? { ...profile, model: null } : profile,
              ),
            );
          })
          .catch((err) => {
            setError(formatError(err));
          });
        return;
      }

      const decoded = decodeModelSelection(selection);

      if (!decoded) {
        return;
      }

      void updateProfileMutation
        .mutateAsync({
          profileId,
          input: { model: decoded.modelId },
        })
        .then(() => {
          setProfiles((current) =>
            current.map((profile) =>
              profile.id === profileId
                ? { ...profile, model: decoded.modelId }
                : profile,
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
            response.profiles.find((profile) => profile.id === "profile_default") ??
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
      setSession(null);
      setMessages([]);
      setError(null);
      setAgentTodos([]);

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
          messages: storedMessages,
          messageMeta,
          todos,
        } = await client.getSessionMessages(sessionId);
        const nextSession = client.createChatSession(sessionId, "web");
        setProfileId(nextProfileId);
        setSession(nextSession);
        setMessages(chatMessagesToListItems(storedMessages, messageMeta));
        setAgentTodos(todos);
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
    setSearchParams({}, { replace: true });

    const targetProfileId = requestedProfile || profileId;
    if (!targetProfileId) {
      return;
    }

    skipNextProfileSessionRef.current = true;

    if (requestedProfile && requestedProfile !== profileId) {
      setProfileId(requestedProfile);
    }

    enterDraftChat(targetProfileId);
  }, [searchParams, setSearchParams, profileId, enterDraftChat]);

  useEffect(() => {
    if (!profileId) {
      return;
    }

    if (routeSession) {
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

  const sendMessage = useCallback(
    async (text: string, files: FileUIPart[] = [], options: SendMessageOptions = {}) => {
      const images = filePartsToImageAttachments(files);
      const documents = filePartsToDocumentAttachments(files);

      if ((!text.trim() && images.length === 0 && documents.length === 0) || !profileId || busy) {
        return;
      }

      setBusy(true);
      setError(null);

      if (options.initialMessages) {
        setMessages(options.initialMessages);
        setAgentTodos([]);
      }

      let activeSession = options.sessionOverride ?? session;

      if (!activeSession) {
        try {
          activeSession = await client.createSession("web", { profileId });
          localStorage.setItem(sessionStorageKey(profileId), activeSession.id);
          setSession(activeSession);
          syncChatUrl(profileId, activeSession.id);
        } catch (err) {
          setError(formatError(err));
          setBusy(false);
          return;
        }
      }

      appendOutgoingMessages(
        setMessages,
        text,
        images.map((image) => ({
          mediaType: image.mediaType,
          url: `data:${image.mediaType};base64,${image.data}`,
        })),
        documents.map((document) => ({
          filename: document.filename,
          mediaType: document.mediaType,
        })),
        { thinkingEnabled: thinkingSettings?.enabled ?? true },
      );

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
          buildStreamHandlers(setMessages, { onTodosUpdated: setAgentTodos }),
          { signal: abortController.signal },
        );

        const {
          messages: storedMessages,
          messageMeta,
          todos,
        } = await client.getSessionMessages(activeSession.id);
        setMessages(chatMessagesToListItems(storedMessages, messageMeta));
        setAgentTodos(todos);
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
            setSession(nextSession);
            setError("Chat session expired. Started a new session — please send again.");
            setMessages((current) => current.filter((message) => !message.streaming));
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
      }
    },
    [session, busy, profileId, syncChatUrl, thinkingSettings?.enabled],
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

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {messages.length === 0 && !busy ? (
            <ChatWelcome profile={activeProfile} />
          ) : (
            <ChatMessageList
              messages={messages}
              branchingMessageId={branchingMessageId}
              actionsDisabled={busy}
              onBranchMessage={(message) => void handleBranchMessage(message)}
              onRetryMessage={(message) => void handleTryAgainMessage(message)}
            />
          )}
        </div>

        <div className="sticky bottom-0 z-10 mt-auto w-full shrink-0 bg-background/95 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <ChatComposer
            className="py-0"
            chatStatus={chatStatus}
            busy={busy}
            canStop={canStop}
            disabled={!profileId}
            error={error}
            profileId={profileId}
            profiles={profiles}
            activeProfile={activeProfile}
            onProfileSwitch={handleProfileSwitch}
            showOfflineHint={showOfflineHint}
            providerConfigured={health?.providerConfigured}
            onNavigateSetup={() => navigate(SETUP_PATH)}
            providerModelGroups={providerModelGroups}
            inheritModelLabel={profileModelLabel(
              null,
              providerModelGroups,
              models?.defaultModel ?? models?.currentModel,
            )}
            profileModelId={activeProfile?.model ?? null}
            currentModelSelection={currentModelSelection}
            onModelChange={handleModelChange}
            renderModelLabel={renderModelLabel}
            todos={agentTodos}
            onSubmit={(text, files) => void sendMessage(text, files)}
            onStop={stopStreaming}
          />
        </div>
      </div>
    </div>
  );
}

function findRetryPrompt(
  messages: ChatListItem[],
  assistantMessage: ChatListItem,
): ChatListItem | null {
  if (typeof assistantMessage.historyIndex !== "number") {
    return null;
  }

  return (
    messages.findLast(
      (message) =>
        message.role === "user" &&
        typeof message.historyIndex === "number" &&
        message.historyIndex < assistantMessage.historyIndex!,
    ) ?? null
  );
}

function findRetryCheckpoint(
  messages: ChatListItem[],
  promptMessage: ChatListItem,
): ChatListItem | null {
  if (typeof promptMessage.historyIndex !== "number") {
    return null;
  }

  return (
    messages.findLast(
      (message) =>
        typeof message.historyIndex === "number" &&
        message.historyIndex < promptMessage.historyIndex!,
    ) ?? null
  );
}

function ChatWelcome({ profile }: { profile: ProfileSummary | undefined }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10 pt-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border border-border/80 bg-card shadow-sm">
        {profile ? (
          <ProfileAvatar profile={profile} size="lg" className="size-12" />
        ) : (
          <MessageCircleIcon className="size-6 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <h2 className="type-section-title mt-5">
        {profile ? `Chat with ${profile.name}` : "Start chatting"}
      </h2>
      <p className="type-body mt-1.5 max-w-sm">
        {profile?.isSuper
          ? "Ask anything, attach images, or run tools."
          : "Ask a question or attach an image to get started."}
      </p>
    </div>
  );
}
