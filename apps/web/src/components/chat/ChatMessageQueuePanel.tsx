import {
  Cancel01Icon,
  Copy01Icon,
  PencilEdit02Icon,
  Tick02Icon,
} from "hugeicons-react";
import { useEffect, useState } from "react";

export interface QueuedComposerMessage {
  attachmentCount: number;
  id: string;
  text: string;
}

interface QueueActions {
  onEdit?: (id: string, text: string) => void;
  onRemove?: (id: string) => void;
  onSendNow?: (id: string) => void;
}

interface ChatMessageQueuePanelProps extends QueueActions {
  messages: QueuedComposerMessage[];
}

const ACTION_CLASS =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md bg-transparent px-2 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const ICON_ACTION_CLASS = `${ACTION_CLASS} w-7 px-0`;

export function ChatMessageQueuePanel({
  messages,
  ...actions
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
        <QueuedBubble key={message.id} message={message} {...actions} />
      ))}
    </ol>
  );
}

function attachmentText(count: number) {
  return count > 0 ? `${count} attachment${count === 1 ? "" : "s"}` : null;
}

function QueuedBubble({
  message,
  onEdit,
  onRemove,
  onSendNow,
}: QueueActions & { message: QueuedComposerMessage }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => setCopied(false), 1500);

    return () => clearTimeout(timer);
  }, [copied]);

  const attachmentLabel = attachmentText(message.attachmentCount);

  const label = message.text
    ? [message.text, attachmentLabel].filter(Boolean).join(" · ")
    : attachmentLabel;

  if (!label) {
    return null;
  }

  const saveDraft = () => {
    if (draft !== null && onEdit && (draft.trim() || attachmentLabel)) {
      onEdit(message.id, draft);
    }

    setDraft(null);
  };

  if (draft !== null) {
    return (
      <li className="flex w-full max-w-[85%] flex-col items-end gap-0.5">
        <textarea
          aria-label="Edit queued message"
          className="field-sizing-content max-h-40 w-full resize-none rounded-2xl border border-border bg-background px-4 py-2 text-foreground text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDraft(null);
            } else if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              saveDraft();
            }
          }}
          ref={(node) => node?.focus()}
          value={draft}
        />
        <div className="flex items-center gap-0.5">
          <button
            className={ACTION_CLASS}
            onClick={() => setDraft(null)}
            type="button"
          >
            Cancel
          </button>
          <button className={ACTION_CLASS} onClick={saveDraft} type="button">
            Save
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="todo-item-enter flex min-w-0 max-w-[85%] flex-col items-end gap-0.5">
      <div className="flex min-w-0 items-center gap-0.5">
        {message.text ? (
          <button
            aria-label={copied ? "Copied" : "Copy queued message"}
            className={ICON_ACTION_CLASS}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(message.text);
                setCopied(true);
              } catch {
                // Clipboard can be blocked; the icon just stays as is.
              }
            }}
            type="button"
          >
            {copied ? (
              <Tick02Icon aria-hidden="true" className="size-3.5" />
            ) : (
              <Copy01Icon aria-hidden="true" className="size-3.5" />
            )}
          </button>
        ) : null}
        {onEdit ? (
          <button
            aria-label="Edit queued message"
            className={ICON_ACTION_CLASS}
            onClick={() => setDraft(message.text)}
            type="button"
          >
            <PencilEdit02Icon aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
        {onRemove ? (
          <button
            aria-label="Remove queued message"
            className={ICON_ACTION_CLASS}
            onClick={() => onRemove(message.id)}
            type="button"
          >
            <Cancel01Icon aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
        <p className="ml-1 min-w-0 whitespace-pre-wrap break-words rounded-2xl bg-muted px-4 py-2 text-muted-foreground text-sm">
          {label}
        </p>
      </div>
      {onSendNow ? (
        <button
          className={ACTION_CLASS}
          onClick={() => onSendNow(message.id)}
          type="button"
        >
          Send now
        </button>
      ) : null}
    </li>
  );
}
