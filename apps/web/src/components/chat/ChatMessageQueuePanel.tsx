import { ChevronDownIcon, ClockIcon } from "lucide-react";
import { useState } from "react";
import { Matrix } from "@/components/ui/matrix";
import type { Frame } from "@/components/ui/matrix-frames";
import { cn } from "@/lib/utils";

export interface QueuedComposerMessage {
  id: string;
  text: string;
  attachmentCount: number;
}

interface ChatMessageQueuePanelProps {
  messages: QueuedComposerMessage[];
  stack?: boolean;
}

const QUEUED_MATRIX_ROWS = 3;
const QUEUED_MATRIX_COLS = 2;
const QUEUED_MATRIX_SIZE = 3;
const QUEUED_MATRIX_GAP = 1;

const queuedPendingPattern: Frame = [
  [0, 0],
  [0, 0],
  [0, 0],
];

function QueuedStatusIcon() {
  return (
    <Matrix
      rows={QUEUED_MATRIX_ROWS}
      cols={QUEUED_MATRIX_COLS}
      size={QUEUED_MATRIX_SIZE}
      gap={QUEUED_MATRIX_GAP}
      className="inline-flex h-4 w-auto shrink-0 items-center justify-center"
      pattern={queuedPendingPattern}
      ariaLabel="Queued"
      brightness={0.55}
      palette={{
        on: "var(--muted-foreground)",
        off: "var(--muted-foreground)",
      }}
    />
  );
}

export function ChatMessageQueuePanel({
  messages,
  stack = false,
}: ChatMessageQueuePanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (messages.length === 0) {
    return null;
  }

  const firstMessage = messages[0];
  const headerLabel = expanded
    ? `Queued${messages.length > 1 ? ` (${messages.length})` : ""}`
    : (firstMessage?.text ||
        (firstMessage?.attachmentCount
          ? `${firstMessage.attachmentCount} attachment${firstMessage.attachmentCount === 1 ? "" : "s"}`
          : "Queued"));

  const list = (
    <ul className={cn("space-y-1.5", stack ? "pb-2.5 pl-7 pr-3" : "mt-1")}>
      {messages.map((message, index) => (
        <QueuedRow key={message.id} message={message} index={index} />
      ))}
    </ul>
  );

  const header = (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground",
        stack ? "px-3 py-1.5" : "mb-0.5",
      )}
      onClick={() => setExpanded((current) => !current)}
      aria-expanded={expanded}
    >
      <ChevronDownIcon
        className={cn(
          "size-3.5 shrink-0 transition-transform duration-200",
          !expanded && "-rotate-90",
        )}
        aria-hidden="true"
      />
      <ClockIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span
        className={cn(
          "min-w-0 flex-1 truncate transition-opacity duration-200",
          expanded && messages.length > 1 && "tabular-nums",
        )}
      >
        {headerLabel}
      </span>
    </button>
  );

  const expandableList = (
    <div className="todo-panel-expand" data-expanded={expanded}>
      <div className="overflow-hidden pb-1.5">{list}</div>
    </div>
  );

  if (stack) {
    return (
      <div className="px-3">
        <aside
          className="relative z-0 w-full shrink-0 overflow-hidden rounded-t-xl rounded-b-none border border-b-0 border-border bg-card shadow-xs"
          aria-label="Queued messages"
        >
          {header}
          {expandableList}
        </aside>
      </div>
    );
  }

  return (
    <aside
      className="mb-3 rounded-xl border border-border/80 bg-card px-4 py-3 shadow-sm"
      aria-label="Queued messages"
    >
      {header}
      {expandableList}
    </aside>
  );
}

function QueuedRow({
  message,
  index,
}: {
  message: QueuedComposerMessage;
  index: number;
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
    <li
      className="todo-item-enter flex min-w-0 items-center gap-2 pl-1 text-xs leading-none"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <QueuedStatusIcon />
      <span className="min-w-0 truncate text-muted-foreground/50">{label}</span>
    </li>
  );
}
