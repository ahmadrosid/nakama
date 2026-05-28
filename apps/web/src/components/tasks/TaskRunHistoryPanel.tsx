import type { StoredTask } from "@tinyclaw/core/contract";
import { XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTaskMessagesQuery } from "@/hooks/use-tasks";
import { chatMessagesToListItems, type ChatListItem } from "@/lib/chat-history";
import {
  appendOutgoingMessages,
  buildStreamHandlers,
  deriveChatStatus,
  finalizeStreamingMessages,
  isAbortError,
} from "@/lib/chat-stream";
import { client, formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

interface TaskRunHistoryPanelProps {
  task: StoredTask;
  onClose: () => void;
}

export function TaskRunHistoryPanel({ task, onClose }: TaskRunHistoryPanelProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, error: loadError } = useTaskMessagesQuery(task.id);

  const [messages, setMessages] = useState<ChatListItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(task.sessionId);
  const [busy, setBusy] = useState(false);
  const [canStop, setCanStop] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamAbortRef = useRef<AbortController | null>(null);
  const loadedTaskRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data || loadedTaskRef.current === `${task.id}:${data.sessionId}`) {
      return;
    }

    loadedTaskRef.current = `${task.id}:${data.sessionId}`;
    setSessionId(data.sessionId);
    setMessages(chatMessagesToListItems(data.messages));
    setError(null);

    if (!task.sessionId && data.sessionId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    }
  }, [data, queryClient, task.id, task.sessionId]);

  useEffect(() => {
    loadedTaskRef.current = null;
    setMessages([]);
    setSessionId(task.sessionId);
    setError(null);
    setBusy(false);
    setCanStop(false);
  }, [task.id]);

  const chatStatus = useMemo(
    () => deriveChatStatus(busy, error, messages),
    [busy, error, messages],
  );

  const stopStreaming = useCallback(() => {
    streamAbortRef.current?.abort();
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || busy || !sessionId) {
        return;
      }

      setBusy(true);
      setError(null);

      const chatSession = client.createChatSession(sessionId, "task");
      appendOutgoingMessages(setMessages, text);

      const abortController = new AbortController();
      streamAbortRef.current = abortController;
      setCanStop(true);

      try {
        await chatSession.sendStream(
          { message: text },
          buildStreamHandlers(setMessages),
          { signal: abortController.signal },
        );

        setMessages((current) => finalizeStreamingMessages(current));
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.messages(task.id) });
      } catch (err) {
        if (isAbortError(err)) {
          setMessages((current) => finalizeStreamingMessages(current));
          return;
        }

        setError(formatError(err));
        setMessages((current) => current.filter((message) => !message.streaming));
      } finally {
        streamAbortRef.current = null;
        setCanStop(false);
        setBusy(false);
      }
    },
    [busy, queryClient, sessionId, task.id],
  );

  const displayError = error ?? (loadError ? formatError(loadError) : null);
  const chatUnavailable = !sessionId && !isLoading && messages.length > 0;

  return (
    <aside
      className={cn(
        "flex min-h-[24rem] shrink-0 flex-col bg-background",
        "border-t border-border/80",
        "lg:h-full lg:min-h-0 lg:w-[24rem] lg:border-t-0 lg:border-l lg:border-border/80",
        "xl:w-[26rem]",
        "lg:shadow-[-16px_0_40px_-24px_rgba(0,0,0,0.22)] dark:lg:shadow-[-16px_0_40px_-24px_rgba(0,0,0,0.5)]",
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border/60 bg-background px-5 py-4">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Task chat
          </p>
          <h2 className="truncate text-sm font-semibold text-foreground">{task.title}</h2>
          <p className="text-xs text-muted-foreground capitalize">
            {task.status.replace("_", " ")} · {task.profileId}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Close task chat"
          onClick={onClose}
        >
          <XIcon className="size-4" aria-hidden />
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        {isLoading && messages.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center">
            <Spinner className="size-5" />
          </div>
        ) : (
          <ChatMessageList
            messages={messages}
            emptyMessage="No messages yet. Send a follow-up below."
            className="absolute inset-0 bg-background"
            contentClassName="px-5 py-4"
          />
        )}
      </div>

      {chatUnavailable ? (
        <div className="shrink-0 space-y-2 border-t border-border/60 px-5 py-4">
          <p className="text-sm text-muted-foreground">
            Run history is shown above. Restart the TinyClaw server to enable follow-up chat.
          </p>
        </div>
      ) : (
        <ChatComposer
          variant="minimal"
          chatStatus={chatStatus}
          busy={busy}
          canStop={canStop}
          disabled={!sessionId || isLoading}
          error={displayError}
          placeholder="Follow up on this task…"
          className="border-t border-border/60 px-5 py-4"
          onSubmit={(text) => void sendMessage(text)}
          onStop={stopStreaming}
        />
      )}
    </aside>
  );
}
