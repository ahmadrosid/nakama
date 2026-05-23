import type { ProfileSummary } from "@tinyclaw/core/contract";
import type { ChatStatus } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
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
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppContext } from "@/context/app-context";
import { cn } from "@/lib/utils";
import { ArrowUpIcon, ChevronRightIcon, EllipsisIcon } from "lucide-react";
import { client, formatError } from "@/lib/client";
import {
  chatMessagesToListItems,
  sessionStorageKey,
  type ChatListItem,
  type RequestedChatSession,
} from "@/lib/chat-history";
import { Spinner } from "@/components/ui/spinner";
import type { RemoteChatSession } from "@tinyclaw/client";

interface ChatPageProps {
  requestedSession?: RequestedChatSession | null;
  onRequestedSessionHandled?: () => void;
}

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

export function ChatPage({
  requestedSession = null,
  onRequestedSessionHandled,
}: ChatPageProps) {
  const { health, models, loading, setModel } = useAppContext();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [profileId, setProfileId] = useState("");
  const [session, setSession] = useState<RemoteChatSession | null>(null);
  const [messages, setMessages] = useState<ChatListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipNextProfileSessionRef = useRef(false);

  const chatStatus = useMemo(
    () => deriveChatStatus(busy, error, messages),
    [busy, error, messages]
  );

  const showOfflineHint = health != null && !health.providerConfigured;

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId),
    [profiles, profileId]
  );

  const profileInitial =
    activeProfile?.name?.charAt(0)?.toUpperCase() ??
    activeProfile?.id?.charAt(0)?.toUpperCase() ??
    "?";

  const loadProfiles = useCallback(async () => {
    try {
      const response = await client.listProfiles();
      setProfiles(response.profiles);

      if (!profileId && response.profiles.length > 0) {
        const defaultProfile =
          response.profiles.find((profile) => profile.id === "profile_default") ??
          response.profiles[0]!;
        setProfileId(defaultProfile.id);
      }
    } catch (err) {
      setError(formatError(err));
    }
  }, [profileId]);

  const startSession = useCallback(async (nextProfileId: string, options?: { forceNew?: boolean }) => {
    setBusy(true);
    setError(null);

    try {
      const storageKey = sessionStorageKey(nextProfileId);

      if (!options?.forceNew) {
        const storedSessionId = localStorage.getItem(storageKey);

        if (storedSessionId) {
          try {
            const { messages: storedMessages } =
              await client.getSessionMessages(storedSessionId);
            const nextSession = client.createChatSession(storedSessionId, "web");
            setSession(nextSession);
            setMessages(chatMessagesToListItems(storedMessages));
            return;
          } catch {
            localStorage.removeItem(storageKey);
          }
        }
      } else {
        localStorage.removeItem(storageKey);
      }

      const nextSession = await client.createSession("web", {
        profileId: nextProfileId || undefined,
      });
      localStorage.setItem(storageKey, nextSession.id);
      setSession(nextSession);
      setMessages([]);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }, []);

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
      } catch (err) {
        setError(formatError(err));
      } finally {
        setBusy(false);
      }
    },
    [profileId],
  );

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!profileId) {
      return;
    }

    if (skipNextProfileSessionRef.current) {
      skipNextProfileSessionRef.current = false;
      return;
    }

    void startSession(profileId);
  }, [profileId, startSession]);

  useEffect(() => {
    if (!requestedSession) {
      return;
    }

    void resumeSession(requestedSession.profileId, requestedSession.sessionId).finally(() => {
      onRequestedSessionHandled?.();
    });
  }, [requestedSession, resumeSession, onRequestedSessionHandled]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text || !session || busy) {
        return;
      }

      setBusy(true);
      setError(null);
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", content: text },
      ]);
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: "", streaming: true },
      ]);

      try {
        await session.sendStream(text, {
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
        });

        setMessages((current) => {
          const next = [...current];

          for (let index = next.length - 1; index >= 0; index -= 1) {
            const message = next[index];

            if (message?.role === "assistant") {
              next[index] = { ...message, streaming: false };
              break;
            }
          }

          return next;
        });
      } catch (err) {
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
        setBusy(false);
      }
    },
    [session, busy, profileId]
  );

  async function handleClear() {
    if (!session || busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await session.clear();
      setMessages([]);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="gap-6 py-4">
            {messages.length === 0 ? (
              <ConversationEmptyState
                title="Start a conversation"
                description="Choose a profile and model in the composer below, then send a message. Changing the model clears server-side chat history."
              />
            ) : (
              messages.map((message) => (
                <Message
                  key={message.id}
                  from={message.role === "tool" ? "assistant" : message.role}
                  className="mr-auto ml-0 max-w-full justify-start"
                >
                  <MessageContent className="ml-0 max-w-full group-[.is-user]:ml-0">
                    {message.role === "user" ? (
                      message.content
                    ) : message.role === "tool" ? (
                      <ToolMessageContent message={message} />
                    ) : (
                      <MessageResponse isAnimating={message.streaming}>
                        {message.content || (message.streaming ? "…" : "")}
                      </MessageResponse>
                    )}
                  </MessageContent>
                </Message>
              ))
            )}
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
            <p className="text-xs text-amber-200/90 sm:hidden">
              No provider configured — limited responses.
            </p>
          ) : null}
          <PromptInput
            className="[&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:flex-col [&_[data-slot=input-group]]:items-stretch [&_[data-slot=input-group]]:gap-0 [&_[data-slot=input-group]]:rounded-md [&_[data-slot=input-group]]:border-border [&_[data-slot=input-group]]:bg-card [&_[data-slot=input-group]]:p-4 [&_[data-slot=input-group]]:shadow-sm"
            onSubmit={({ text }) => void sendMessage(text.trim())}
          >
            <PromptInputBody>
              <PromptInputTextarea
                className="!min-h-10 max-h-32 px-1 py-0.5 text-sm"
                placeholder="Enter a message…"
                disabled={busy || !session}
              />
            </PromptInputBody>
            <PromptInputFooter className="w-full items-center justify-between border-0 px-0 pt-3 pb-0">
              <div className="flex min-w-0 items-center gap-2.5">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        aria-label="Switch profile"
                        className="size-9 shrink-0 rounded-full bg-muted text-sm font-medium text-foreground hover:bg-muted/80"
                      />
                    }
                  >
                    {profileInitial}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {profiles.map((profile) => (
                      <DropdownMenuItem
                        key={profile.id}
                        disabled={busy || profile.id === profileId}
                        onClick={() => setProfileId(profile.id)}
                      >
                        {profile.name}
                        {profile.isSuper ? " (super)" : ""}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {health?.providerConfigured && models ? (
                  <PromptInputSelect
                    value={models.currentModel ?? ""}
                    disabled={!models.models.length || busy}
                    onValueChange={(value) =>
                      void setModel(value != null ? String(value) : "")
                    }
                  >
                    <PromptInputSelectTrigger className="h-9 max-w-48 rounded-full bg-muted px-4 text-sm font-medium text-foreground hover:bg-muted/80">
                      <PromptInputSelectValue placeholder="Model" />
                    </PromptInputSelectTrigger>
                    <PromptInputSelectContent>
                      {models.models.map((model) => (
                        <PromptInputSelectItem key={model.id} value={model.id}>
                          {model.name}
                        </PromptInputSelectItem>
                      ))}
                    </PromptInputSelectContent>
                  </PromptInputSelect>
                ) : (
                  <span className="rounded-full bg-muted px-4 py-2 text-sm font-medium text-amber-200/90">
                    Offline
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  className={[
                    "size-2 rounded-full",
                    loading
                      ? "animate-pulse bg-muted-foreground"
                      : health?.ok
                        ? "bg-emerald-500"
                        : "bg-red-500",
                  ].join(" ")}
                  title={
                    loading
                      ? "Checking connection"
                      : health?.ok
                        ? "Server online"
                        : "Server offline"
                  }
                />

                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label="Chat actions"
                        className="size-9 rounded-md border-border text-muted-foreground"
                      />
                    }
                  >
                    <EllipsisIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={busy || !session}
                      onClick={() => void startSession(profileId, { forceNew: true })}
                    >
                      New session
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={busy || !session}
                      onClick={() => void handleClear()}
                    >
                      Clear history
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <span className="mx-0.5 h-6 w-px bg-border" aria-hidden />

                <PromptInputSubmit
                  status={chatStatus}
                  disabled={busy || !session}
                  className="size-10 shrink-0 rounded-full bg-primary text-primary-foreground shadow-none hover:bg-primary/90 disabled:opacity-50"
                >
                  <ArrowUpIcon className="size-4" />
                </PromptInputSubmit>
              </div>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
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
