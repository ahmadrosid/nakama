import type { ProfileSummary } from "@tinyclaw/core/contract";
import type { FileUIPart } from "ai";
import { MessageCircleIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { RemoteChatSession } from "@tinyclaw/client";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { useAppContext } from "@/context/app-context";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { filePartsToImageAttachments } from "@/lib/chat-images";
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
import { filterModelsByProvider } from "@/lib/models";

export function ChatPage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { navigateToPage } = useAppNavigation();
  const routeSession = useMemo(() => parseChatRouteParams(params), [params]);
  const { health, models, setModel } = useAppContext();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [profileId, setProfileId] = useState(
    () => readRequestedProfileFromNewChatSearch(location.search) ?? "",
  );
  const [session, setSession] = useState<RemoteChatSession | null>(null);
  const [messages, setMessages] = useState<ChatListItem[]>([]);
  const [busy, setBusy] = useState(false);
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

  const providerModels = useMemo(
    () => filterModelsByProvider(models?.models ?? [], models?.provider),
    [models?.models, models?.provider],
  );

  const renderModelLabel = useCallback(
    (modelId: string | null) => {
      if (!modelId) {
        return null;
      }

      return providerModels.find((model) => model.id === modelId)?.name ?? modelId;
    },
    [providerModels],
  );

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId),
    [profiles, profileId],
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
        const { messages: storedMessages } = await client.getSessionMessages(sessionId);
        const nextSession = client.createChatSession(sessionId, "web");
        setProfileId(nextProfileId);
        setSession(nextSession);
        setMessages(chatMessagesToListItems(storedMessages));
        syncChatUrl(nextProfileId, sessionId);
      } catch (err) {
        setError(formatError(err));
      } finally {
        setBusy(false);
      }
    },
    [profileId, syncChatUrl],
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
    async (text: string, files: FileUIPart[] = []) => {
      const images = filePartsToImageAttachments(files);

      if ((!text.trim() && images.length === 0) || !profileId || busy) {
        return;
      }

      setBusy(true);
      setError(null);

      let activeSession = session;

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
      );

      const abortController = new AbortController();
      streamAbortRef.current = abortController;
      setCanStop(true);

      try {
        await activeSession.sendStream(
          { message: text, images: images.length > 0 ? images : undefined },
          buildStreamHandlers(setMessages),
          { signal: abortController.signal },
        );

        setMessages((current) => finalizeStreamingMessages(current));
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
    [session, busy, profileId, syncChatUrl],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        {messages.length === 0 && !busy ? (
          <ChatWelcome profile={activeProfile} />
        ) : (
          <ChatMessageList messages={messages} />
        )}

        <ChatComposer
          className="py-4"
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
          onNavigateSettings={() => navigateToPage("settings")}
          providerModels={providerModels}
          currentModel={models?.currentModel ?? null}
          onModelChange={setModel}
          renderModelLabel={renderModelLabel}
          onSubmit={(text, files) => void sendMessage(text, files)}
          onStop={stopStreaming}
        />
      </div>
    </div>
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
