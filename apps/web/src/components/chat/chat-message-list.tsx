import { useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  GitBranchIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
} from "lucide-react";
import {
  AssistantTurnSegmentView,
} from "@/components/chat/assistant-tool-group";
import { segmentAssistantTurn } from "@/components/chat/assistant-tool-group.shared";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
} from "@/components/ai-elements/message";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatSessionTimestamp, type ChatListItem } from "@/lib/chat-history";
import { isPastedTextDocument } from "@/lib/pasted-text";
import { TextAttachmentPreview } from "@/components/chat/text-attachment-preview";
import { ImageAttachmentPreview } from "@/components/chat/image-attachment-preview";
import { ArtifactAttachmentPreview } from "@/components/chat/artifact-attachment-preview";
import { extractTurnArtifacts } from "@/lib/chat-artifacts";
import { cn } from "@/lib/utils";

interface ChatMessageListProps {
  messages: ChatListItem[];
  profileId?: string | null;
  showThinking?: boolean;
  modelLabel?: string | null;
  branchingMessageId?: string | null;
  actionsDisabled?: boolean;
  onBranchMessage?: (message: ChatListItem) => void;
  onRetryMessage?: (message: ChatListItem) => void;
  emptyMessage?: string;
  className?: string;
  contentClassName?: string;
}

type IndexedMessage = { message: ChatListItem; index: number };

type MessageTurn =
  | { kind: "user"; message: ChatListItem; index: number }
  | { kind: "assistant"; messages: IndexedMessage[] };

export function ChatMessageList({
  messages,
  profileId,
  showThinking = true,
  modelLabel,
  branchingMessageId,
  actionsDisabled = false,
  onBranchMessage,
  onRetryMessage,
  emptyMessage,
  className,
  contentClassName,
}: ChatMessageListProps) {
  const turns = groupMessagesIntoTurns(messages);

  return (
    <Conversation className={cn("min-h-0 flex-1", className)}>
      <ConversationContent className={cn("gap-6 py-4", contentClassName)}>
        {messages.length === 0 && emptyMessage ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : null}
        {turns.map((turn) =>
          turn.kind === "user" ? (
            <ChatMessageRow key={turn.message.id} message={turn.message} />
          ) : (
            <AssistantTurn
              key={turn.messages.map(({ message }) => message.id).join(":")}
              messages={turn.messages}
              profileId={profileId}
              showThinking={showThinking}
              modelLabel={modelLabel}
              branchingMessageId={branchingMessageId}
              actionsDisabled={actionsDisabled}
              onBranchMessage={onBranchMessage}
              onRetryMessage={onRetryMessage}
            />
          ),
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

function groupMessagesIntoTurns(messages: ChatListItem[]): MessageTurn[] {
  const turns: MessageTurn[] = [];
  let currentAssistantTurn: IndexedMessage[] | null = null;

  for (const [index, message] of messages.entries()) {
    if (message.role === "user") {
      if (currentAssistantTurn) {
        turns.push({ kind: "assistant", messages: currentAssistantTurn });
        currentAssistantTurn = null;
      }

      turns.push({ kind: "user", message, index });
      continue;
    }

    currentAssistantTurn ??= [];
    currentAssistantTurn.push({ message, index });
  }

  if (currentAssistantTurn) {
    turns.push({ kind: "assistant", messages: currentAssistantTurn });
  }

  return turns;
}

function AssistantTurn({
  messages,
  profileId,
  showThinking,
  modelLabel,
  branchingMessageId,
  actionsDisabled,
  onBranchMessage,
  onRetryMessage,
}: {
  messages: IndexedMessage[];
  profileId?: string | null;
  showThinking: boolean;
  modelLabel?: string | null;
  branchingMessageId?: string | null;
  actionsDisabled?: boolean;
  onBranchMessage?: (message: ChatListItem) => void;
  onRetryMessage?: (message: ChatListItem) => void;
}) {
  const turnMessages = messages.map(({ message }) => message);
  const segments = segmentAssistantTurn(turnMessages);
  const artifacts = extractTurnArtifacts(turnMessages);
  const turnKey = messages.map(({ message }) => message.id).join(":");
  const anchorMessage = findAssistantTurnAnchor(turnMessages);
  const showActions = isAssistantTurnComplete(turnMessages) && anchorMessage != null;

  return (
    <div className="group flex w-full max-w-full flex-col gap-3 mr-auto ml-0 items-start justify-start">
      {segments.map((segment) => (
        <AssistantTurnSegmentView
          key={
            segment.kind === "work"
              ? `work:${segment.thinking?.id ?? "thought"}:${segment.tools.map((message) => message.id).join(":")}`
              : `text:${segment.message.id}`
          }
          segment={segment}
          showThinking={showThinking}
          modelLabel={modelLabel}
        />
      ))}
      {profileId && artifacts.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {artifacts.map((artifact) => {
            const chipId = `${turnKey}:${artifact.path}`;

            return (
              <ArtifactAttachmentPreview
                key={chipId}
                id={chipId}
                profileId={profileId}
                artifact={artifact}
              />
            );
          })}
        </div>
      ) : null}
      {showActions && anchorMessage ? (
        <AssistantMessageActions
          message={anchorMessage}
          copyContent={assistantTurnContent(turnMessages)}
          busy={branchingMessageId === anchorMessage.id}
          actionsDisabled={actionsDisabled}
          onBranchMessage={onBranchMessage}
          onRetryMessage={onRetryMessage}
        />
      ) : null}
    </div>
  );
}

function ChatMessageRow({ message }: { message: ChatListItem }) {
  return (
    <Message
      from="user"
      className="max-w-full ml-auto mr-0 items-end justify-end"
    >
      <MessageContent className="max-w-full ml-auto group-[.is-user]:ml-auto">
        <UserMessageContent message={message} />
      </MessageContent>
    </Message>
  );
}

function isAssistantTurnComplete(messages: ChatListItem[]): boolean {
  return (
    messages.some((message) => message.role === "assistant" && !message.streaming) &&
    !messages.some(
      (message) =>
        (message.role === "assistant" && message.streaming) ||
        (message.role === "tool" && message.toolStatus === "running"),
    )
  );
}

function findAssistantTurnAnchor(messages: ChatListItem[]): ChatListItem | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === "assistant" && !message.streaming) {
      return message;
    }
  }

  return null;
}

function assistantTurnContent(messages: ChatListItem[]): string {
  return messages
    .filter((message) => message.role === "assistant" && message.content.trim())
    .map((message) => message.content.trim())
    .join("\n\n");
}

function isBranchableAssistantMessage(message: ChatListItem): boolean {
  return (
    message.role === "assistant" &&
    !message.streaming &&
    typeof message.historyIndex === "number" &&
    Boolean(message.createdAt)
  );
}

function AssistantMessageActions({
  message,
  copyContent,
  busy,
  actionsDisabled = false,
  onBranchMessage,
  onRetryMessage,
}: {
  message: ChatListItem;
  copyContent: string;
  busy: boolean;
  actionsDisabled?: boolean;
  onBranchMessage?: (message: ChatListItem) => void;
  onRetryMessage?: (message: ChatListItem) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  async function copyMessage() {
    const content = copyContent.trim();

    if (!content) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch {
      // Clipboard may be unavailable outside secure contexts.
    }
  }

  const branchCreatedAt = isBranchableAssistantMessage(message) ? message.createdAt : null;

  return (
    <div className="flex items-center gap-1 pt-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <button
        type="button"
        aria-label={copied ? "Copied" : "Copy response"}
        title={copied ? "Copied" : "Copy response"}
        disabled={!copyContent.trim()}
        onClick={() => void copyMessage()}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40",
          copied && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {copied ? (
          <CheckIcon className="size-4" aria-hidden />
        ) : (
          <CopyIcon className="size-4" aria-hidden />
        )}
      </button>
      {onRetryMessage ? (
        <button
          type="button"
          aria-label="Try again"
          title="Try again"
          disabled={busy || actionsDisabled}
          onClick={() => onRetryMessage(message)}
          className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
        >
          <RotateCcwIcon className="size-4" aria-hidden />
        </button>
      ) : null}
      {onBranchMessage && branchCreatedAt ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="Message actions"
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  busy && "pointer-events-none opacity-60",
                )}
              />
            }
          >
            <MoreHorizontalIcon className="size-4" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 min-w-56 p-1.5">
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {formatSessionTimestamp(branchCreatedAt)}
            </div>
            <DropdownMenuItem
              disabled={busy}
              onClick={() => onBranchMessage(message)}
              className="gap-2"
            >
              <GitBranchIcon className="size-4" aria-hidden />
              <span>Branch in new chat</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function UserMessageContent({ message }: { message: ChatListItem }) {
  if (message.questionnaireAnswers?.length) {
    return (
      <div className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3">
        <p className="mb-2 text-sm font-medium text-muted-foreground">Answers</p>
        <div className="space-y-3">
          {message.questionnaireAnswers.map((entry) => (
            <div key={`${entry.questionId}:${entry.prompt}`} className="space-y-1">
              <p className="whitespace-pre-wrap text-foreground">{entry.prompt}</p>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {entry.answer}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const pastedTextDocuments =
    message.documents?.filter((document) =>
      isPastedTextDocument(document.filename, document.mediaType),
    ) ?? [];
  const otherDocuments =
    message.documents?.filter(
      (document) => !isPastedTextDocument(document.filename, document.mediaType),
    ) ?? [];

  return (
    <div className="space-y-2">
      {message.imageAttachments?.length ? (
        <div className="flex flex-wrap gap-2">
          {message.imageAttachments.map((image, index) => (
            <ImageAttachmentPreview
              key={image.url ?? `image-attachment-${index}`}
              url={image.url}
              description={image.description}
              caption={message.content || null}
            />
          ))}
        </div>
      ) : null}
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
      {pastedTextDocuments.length ? (
        <div className="flex flex-wrap gap-2">
          {pastedTextDocuments.map((document) => (
            <TextAttachmentPreview
              key={`${document.filename}-${document.mediaType}`}
              filename={document.filename}
            />
          ))}
        </div>
      ) : null}
      {otherDocuments.length ? (
        <div className="flex flex-wrap gap-2">
          {otherDocuments.map((document) => (
            <div
              key={`${document.filename}-${document.mediaType}`}
              className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-muted px-3 py-2"
            >
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate text-sm text-foreground">{document.filename}</span>
            </div>
          ))}
        </div>
      ) : null}
      {message.content ? (
        <p className="whitespace-pre-wrap text-foreground">{message.content}</p>
      ) : null}
    </div>
  );
}
