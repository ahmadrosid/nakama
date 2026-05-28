import { useEffect, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import type { ChatListItem } from "@/lib/chat-history";
import { formatToolResult, formatToolSummary } from "@/lib/chat-stream";
import { cn } from "@/lib/utils";

interface ChatMessageListProps {
  messages: ChatListItem[];
  emptyMessage?: string;
  className?: string;
  contentClassName?: string;
}

export function ChatMessageList({
  messages,
  emptyMessage,
  className,
  contentClassName,
}: ChatMessageListProps) {
  return (
    <Conversation className={cn("min-h-0 flex-1", className)}>
      <ConversationContent className={cn("gap-6 py-4", contentClassName)}>
        {messages.length === 0 && emptyMessage ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
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
