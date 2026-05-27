import type { ProfileSummary } from "@tinyclaw/core/contract";
import type { ChatStatus } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppContext } from "@/context/app-context";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { cn } from "@/lib/utils";
import {
  ArrowUpIcon,
  ChevronRightIcon,
  ImageIcon,
  MessageCircleIcon,
  SquareIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import type { FileUIPart } from "ai";
import { filePartsToImageAttachments } from "@/lib/chat-images";
import { client, formatError } from "@/lib/client";
import { filterModelsByProvider } from "@/lib/models";
import {
  buildChatBasePath,
  buildChatPath,
  chatMessagesToListItems,
  parseChatRouteParams,
  readRequestedProfileFromNewChatSearch,
  sessionStorageKey,
  type ChatListItem,
} from "@/lib/chat-history";
import { Spinner } from "@/components/ui/spinner";
import type { RemoteChatSession } from "@tinyclaw/client";

const composerIconButtonClass =
  "size-8 shrink-0 rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40";

const composerToolbarClass =
  "flex min-w-0 flex-1 flex-wrap items-center gap-1.5";

const composerShellClass =
  "[&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:flex-col [&_[data-slot=input-group]]:items-stretch [&_[data-slot=input-group]]:gap-0 [&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:border-border [&_[data-slot=input-group]]:bg-card [&_[data-slot=input-group]]:p-3 [&_[data-slot=input-group]]:shadow-sm [&_[data-slot=input-group]]:transition-[box-shadow,border-color] sm:[&_[data-slot=input-group]]:p-4 [&_[data-slot=input-group]:focus-within]:border-primary/30 [&_[data-slot=input-group]:focus-within]:ring-2 [&_[data-slot=input-group]:focus-within]:ring-ring/25";

function formatBashToolResult(result: unknown): string | null {
  if (typeof result !== "object" || result === null) {
    return null;
  }

  const { stdout, stderr, exitCode, timedOut } = result as {
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
    timedOut?: boolean;
  };

  const parts: string[] = [];

  if (stdout) {
    parts.push(stdout.replace(/\r\n/g, "\n").trimEnd());
  }

  if (stderr?.trim()) {
    parts.push(`[stderr]\n${stderr.replace(/\r\n/g, "\n").trimEnd()}`);
  }

  if (timedOut) {
    parts.push("[timed out]");
  }

  if (exitCode != null && exitCode !== 0) {
    parts.push(`[exit code ${exitCode}]`);
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

function formatDefaultToolResult(result: unknown): string | null {
  if (result == null) {
    return null;
  }

  if (typeof result === "string") {
    const trimmed = result.replace(/\r\n/g, "\n").trim();
    return trimmed || null;
  }

  if (typeof result === "object") {
    const error = (result as { error?: unknown }).error;

    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }

    return JSON.stringify(result, null, 2);
  }

  return String(result);
}

function formatToolResult(tool: string | undefined, result: unknown): string | null {
  if (tool === "bash") {
    return formatBashToolResult(result);
  }

  return formatDefaultToolResult(result);
}

function formatToolSummary(
  tool: string | undefined,
  input?: Record<string, unknown>,
): string | null {
  if (tool === "bash" && typeof input?.command === "string" && input.command.trim()) {
    return input.command.trim();
  }

  if (typeof input?.query === "string" && input.query.trim()) {
    return input.query.trim();
  }

  if (typeof input?.path === "string" && input.path.trim()) {
    return input.path.trim();
  }

  if (typeof input?.name === "string" && input.name.trim()) {
    return input.name.trim();
  }

  if (input) {
    for (const value of Object.values(input)) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }

  return null;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function finalizeStreamingMessages(messages: ChatListItem[]): ChatListItem[] {
  const next = messages.map((message) =>
    message.role === "tool" && message.toolStatus === "running"
      ? {
          ...message,
          toolStatus: "done" as const,
          content: `${message.tool} stopped`,
        }
      : message,
  );

  for (let index = next.length - 1; index >= 0; index -= 1) {
    const message = next[index];

    if (message?.role === "assistant") {
      next[index] = { ...message, streaming: false };
      break;
    }
  }

  return next;
}

function deriveChatStatus(
  busy: boolean,
  error: string | null,
  messages: ChatListItem[]
): ChatStatus {
  if (error) {
    return "error";
  }

  const last = messages[messages.length - 1];

  if (last?.role === "assistant" && last.streaming) {
    return "streaming";
  }

  if (busy) {
    return "submitted";
  }

  return "ready";
}

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
    [busy, error, messages]
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
    [profiles, profileId]
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

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: text,
          images: images.map((image) => ({
            mediaType: image.mediaType,
            url: `data:${image.mediaType};base64,${image.data}`,
          })),
        },
      ]);
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: "", streaming: true },
      ]);

      const abortController = new AbortController();
      streamAbortRef.current = abortController;
      setCanStop(true);

      try {
        await activeSession.sendStream(
          { message: text, images: images.length > 0 ? images : undefined },
          {
            onChunk: (delta) => {
              setMessages((current) => {
                const next = [...current];
                const last = next[next.length - 1];

                if (last?.role === "assistant" && last.streaming) {
                  next[next.length - 1] = {
                    ...last,
                    content: last.content + delta,
                    streaming: true,
                  };
                  return next;
                }

                next.push({
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: delta,
                  streaming: true,
                });
                return next;
              });
            },
            onToolStart: (event) => {
              setMessages((current) => {
                const next = current.map((message) =>
                  message.role === "assistant" && message.streaming
                    ? { ...message, streaming: false }
                    : message,
                );

                return [
                  ...next,
                  {
                    id: event.toolCallId,
                    role: "tool",
                    content: event.tool,
                    toolCallId: event.toolCallId,
                    tool: event.tool,
                    toolStatus: "running",
                    toolInput: event.input,
                  },
                ];
              });
            },
            onToolEnd: (event) => {
              setMessages((current) =>
                current.map((message) =>
                  message.toolCallId === event.toolCallId
                    ? {
                        ...message,
                        toolStatus: "done",
                        content: `${event.tool} completed`,
                        toolResult: event.result,
                      }
                    : message,
                ),
              );
            },
          },
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
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="gap-6 py-4">
            {messages.length === 0 && !busy ? (
              <ChatWelcome profile={activeProfile} />
            ) : null}
            {messages.map((message) => (
              <Message
                key={message.id}
                from={message.role === "tool" ? "assistant" : message.role}
                className="mr-auto ml-0 max-w-full justify-start"
              >
                <MessageContent className="ml-0 max-w-full group-[.is-user]:ml-0">
                  {message.role === "user" ? (
                    <UserMessageContent message={message} />
                  ) : message.role === "tool" ? (
                    <ToolMessageContent message={message} />
                  ) : (
                    <MessageResponse isAnimating={message.streaming}>
                      {message.content || (message.streaming ? "…" : "")}
                    </MessageResponse>
                  )}
                </MessageContent>
              </Message>
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="shrink-0 space-y-2 py-4">
          <p
            className={`min-h-5 text-sm ${error ? "text-destructive" : "invisible"}`}
            role={error ? "alert" : undefined}
            aria-hidden={!error}
          >
            {error ?? "\u00a0"}
          </p>
          {showOfflineHint ? (
            <p
              className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
              role="status"
            >
              <WifiOffIcon className="size-3.5 shrink-0" aria-hidden />
              <span>
                No provider configured — limited responses.{" "}
                <button
                  type="button"
                  className="font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
                  onClick={() => navigateToPage("settings")}
                >
                  Configure in Settings
                </button>
              </span>
            </p>
          ) : null}
          <PromptInput
            accept="image/*"
            multiple
            maxFiles={5}
            className={composerShellClass}
            onSubmit={({ text, files }) => void sendMessage(text.trim(), files)}
          >
            <ChatAttachmentHeader />
            <PromptInputBody>
              <PromptInputTextarea
                className="min-h-11 max-h-36 px-1 py-1.5 text-base leading-relaxed placeholder:text-muted-foreground sm:min-h-10 sm:text-sm"
                placeholder="Message…"
                disabled={busy || !profileId}
              />
            </PromptInputBody>
            <PromptInputFooter className="w-full flex-wrap items-center gap-2 border-0 px-0 pt-2.5 pb-0">
              <div
                role="toolbar"
                aria-label="Composer options"
                className={composerToolbarClass}
              >
                <PromptInputTools className="gap-1.5">
                  <ChatAttachmentButton disabled={busy || !profileId} />
                </PromptInputTools>

                <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />

                {health?.providerConfigured && models ? (
                  <PromptInputSelect
                    value={models.currentModel ?? ""}
                    disabled={!providerModels.length || busy}
                    onValueChange={(value) =>
                      void setModel(value != null ? String(value) : "")
                    }
                  >
                    <PromptInputSelectTrigger className="h-8 max-w-[min(12rem,42vw)] truncate rounded-full bg-muted px-2.5 text-[11px] font-medium leading-none text-foreground hover:bg-muted/80 sm:text-xs">
                      <PromptInputSelectValue placeholder="Model">
                        {renderModelLabel}
                      </PromptInputSelectValue>
                    </PromptInputSelectTrigger>
                    <PromptInputSelectContent className="text-xs">
                      {providerModels.map((model) => (
                        <PromptInputSelectItem
                          key={model.id}
                          value={model.id}
                          label={model.name}
                        >
                          {model.name}
                        </PromptInputSelectItem>
                      ))}
                    </PromptInputSelectContent>
                  </PromptInputSelect>
                ) : (
                  <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 text-xs font-medium text-amber-800 dark:text-amber-200">
                    <WifiOffIcon className="size-3.5 shrink-0" aria-hidden />
                    Offline
                  </span>
                )}
              </div>

              <div
                role="toolbar"
                aria-label="Composer actions"
                className="ml-auto flex shrink-0 items-center gap-1.5"
              >
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        aria-label={
                          activeProfile
                            ? `Switch profile (${activeProfile.name})`
                            : "Switch profile"
                        }
                        title={activeProfile?.name ?? "Switch profile"}
                        className={cn(composerIconButtonClass, "p-0")}
                      />
                    }
                  >
                    {activeProfile ? (
                      <ProfileAvatar profile={activeProfile} size="sm" className="size-7" />
                    ) : (
                      <span className="text-xs font-medium">?</span>
                    )}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-52 w-auto">
                    {profiles.map((profile) => (
                      <DropdownMenuItem
                        key={profile.id}
                        disabled={busy || profile.id === profileId}
                        onClick={() => void handleProfileSwitch(profile.id)}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <ProfileAvatar profile={profile} size="sm" />
                          <span className="whitespace-nowrap">
                            {profile.name}
                            {profile.isSuper ? " (super)" : ""}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <span className="h-5 w-px bg-border" aria-hidden />

                <PromptInputSubmit
                  status={chatStatus}
                  disabled={!profileId || (busy && !canStop)}
                  onStop={canStop ? stopStreaming : undefined}
                  aria-label={
                    canStop ? "Stop response" : busy ? "Sending message" : "Send message"
                  }
                  className="size-8 shrink-0 rounded-full bg-primary text-primary-foreground shadow-none transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {canStop ? (
                    <SquareIcon className="size-3.5" />
                  ) : (
                    <ArrowUpIcon className="size-3.5" />
                  )}
                </PromptInputSubmit>
              </div>
            </PromptInputFooter>
          </PromptInput>
        </div>
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

function UserMessageContent({ message }: { message: ChatListItem }) {
  return (
    <div className="space-y-2">
      {message.images?.length ? (
        <div className="flex flex-wrap gap-2">
          {message.images.map((image) => (
            <img
              key={image.url}
              src={image.url}
              alt=""
              className="max-h-40 max-w-full rounded-md border border-border object-contain"
            />
          ))}
        </div>
      ) : null}
      {message.content ? <p className="whitespace-pre-wrap">{message.content}</p> : null}
    </div>
  );
}

function ChatAttachmentHeader() {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) {
    return null;
  }

  return (
    <PromptInputHeader className="pb-0">
      <div className="flex w-full flex-wrap gap-2 border-b border-border/60 pb-3">
        {attachments.files.map((file) => (
          <div
            key={file.id}
            className="relative size-[4.5rem] shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
          >
            <img
              src={file.url}
              alt={file.filename ?? "attachment preview"}
              className="size-full object-cover"
            />
            <button
              type="button"
              className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full border border-border/60 bg-background/90 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background"
              aria-label={`Remove ${file.filename ?? "attachment"}`}
              onClick={() => attachments.remove(file.id)}
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </PromptInputHeader>
  );
}

function ChatAttachmentButton({ disabled }: { disabled: boolean }) {
  const attachments = usePromptInputAttachments();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label="Add image"
            className={composerIconButtonClass}
            onClick={() => attachments.openFileDialog()}
          >
            <ImageIcon className="size-3.5" />
          </Button>
        }
      />
      <TooltipContent side="top">Add image</TooltipContent>
    </Tooltip>
  );
}

function ToolMessageContent({ message }: { message: ChatListItem }) {
  const summary = formatToolSummary(message.tool, message.toolInput);
  const output =
    message.toolStatus === "done"
      ? formatToolResult(message.tool, message.toolResult)
      : null;
  const isRunning = message.toolStatus === "running";
  const hasBody = isRunning || message.toolStatus === "done";
  const [open, setOpen] = useState(isRunning);

  useEffect(() => {
    if (isRunning) {
      setOpen(true);
      return;
    }

    if (message.toolStatus === "done") {
      setOpen(false);
    }
  }, [isRunning, message.toolStatus]);

  const label = isRunning
    ? summary
      ? `Running ${message.tool}: ${summary}`
      : `Running ${message.tool}…`
    : summary
      ? `${message.tool} completed · ${summary}`
      : `${message.tool} completed`;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted/20">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-muted/40",
          !hasBody && "cursor-default hover:bg-transparent",
        )}
        disabled={!hasBody}
        aria-expanded={hasBody ? open : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {hasBody ? (
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {label}
        </span>
        {isRunning ? <Spinner className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      </button>

      {open && hasBody ? (
        <div className="border-t border-border px-3 py-2">
          {isRunning ? (
            <p className="font-mono text-xs text-muted-foreground">Waiting for output…</p>
          ) : output ? (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
              {output}
            </pre>
          ) : (
            <p className="font-mono text-xs text-muted-foreground">No output returned.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
