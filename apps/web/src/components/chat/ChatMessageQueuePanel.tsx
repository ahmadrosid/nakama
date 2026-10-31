import { Cancel01Icon } from "hugeicons-react";

export interface QueuedComposerMessage {
  attachmentCount: number;
  id: string;
  text: string;
}

interface ChatMessageQueuePanelProps {
  messages: QueuedComposerMessage[];
  onRemove?: (id: string) => void;
  onSendNow?: (id: string) => void;
}

const ACTION_CLASS =
  "inline-flex h-7 items-center justify-center gap-1 rounded-md bg-transparent px-2 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ChatMessageQueuePanel({
  messages,
  onRemove,
  onSendNow,
}: ChatMessageQueuePanelProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <ol
      aria-label="Queued messages"
      className="mb-3 flex flex-col items-end gap-2 px-1"
    >
      {messages.map((message) => (
        <QueuedBubble
          key={message.id}
          message={message}
          onRemove={onRemove}
          onSendNow={onSendNow}
        />
      ))}
    </ol>
  );
}

function QueuedBubble({
  message,
  onRemove,
  onSendNow,
}: {
  message: QueuedComposerMessage;
  onRemove?: (id: string) => void;
  onSendNow?: (id: string) => void;
}) {
  const attachmentLabel =
    message.attachmentCount > 0
      ? `${message.attachmentCount} attachment${message.attachmentCount === 1 ? "" : "s"}`
      : null;

  const label = message.text
    ? attachmentLabel
      ? `${message.text} · ${attachmentLabel}`
      : message.text
    : attachmentLabel;

  if (!label) {
    return null;
  }

  return (
    <li className="todo-item-enter flex min-w-0 max-w-[85%] flex-col items-end gap-0.5">
      <p className="min-w-0 whitespace-pre-wrap break-words rounded-2xl bg-muted px-4 py-2 text-muted-foreground text-sm">
        {label}
      </p>
      {onSendNow || onRemove ? (
        <div className="flex items-center gap-0.5">
          {onSendNow ? (
            <button
              className={ACTION_CLASS}
              onClick={() => onSendNow(message.id)}
              type="button"
            >
              Send now
            </button>
          ) : null}
          {onRemove ? (
            <button
              aria-label="Remove queued message"
              className={`${ACTION_CLASS} w-7 px-0`}
              onClick={() => onRemove(message.id)}
              type="button"
            >
              <Cancel01Icon aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
