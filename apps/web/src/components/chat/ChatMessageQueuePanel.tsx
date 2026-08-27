import { ArrowDown01Icon, Clock01Icon } from "hugeicons-react";
import { useState } from "react";
import {
  type ComposerStackEdge,
  composerShelfPanelClass,
} from "@/lib/chat-stream";
import { cn } from "@/lib/utils";

export interface QueuedComposerMessage {
  attachmentCount: number;
  id: string;
  text: string;
}

interface ChatMessageQueuePanelProps {
  messages: QueuedComposerMessage[];
  stack?: boolean;
  stackEdge?: ComposerStackEdge;
}

export function ChatMessageQueuePanel({
  messages,
  stack = false,
  stackEdge = "start",
}: ChatMessageQueuePanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (messages.length === 0) {
    return null;
  }

  const firstMessage = messages[0];
  const headerLabel = expanded
    ? `Queued${messages.length > 1 ? ` (${messages.length})` : ""}`
    : firstMessage?.text ||
      (firstMessage?.attachmentCount
        ? `${firstMessage.attachmentCount} attachment${firstMessage.attachmentCount === 1 ? "" : "s"}`
        : "Queued");

  const list = (
    <ul className={cn("space-y-1.5", stack ? "pr-3 pb-2.5 pl-7" : "mt-1")}>
      {messages.map((message, index) => (
        <QueuedRow index={index} key={message.id} message={message} />
      ))}
    </ul>
  );

  const header = (
    <button
      aria-expanded={expanded}
      className={cn(
        "flex w-full items-center gap-1.5 text-left text-muted-foreground text-xs transition-colors hover:text-foreground",
        stack ? "px-3 py-1.5" : "mb-0.5"
      )}
      onClick={() => setExpanded((current) => !current)}
      type="button"
    >
      <ArrowDown01Icon
        aria-hidden="true"
        className={cn(
          "size-3.5 shrink-0 transition-transform duration-200",
          !expanded && "-rotate-90"
        )}
      />
      <Clock01Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span
        className={cn(
          "min-w-0 flex-1 truncate transition-opacity duration-200",
          expanded && messages.length > 1 && "tabular-nums"
        )}
      >
        {headerLabel}
      </span>
    </button>
  );

  const expandableList = (
    <div className="todo-panel-expand" data-expanded={expanded}>
      <div className="todo-panel-expand-inner overflow-hidden pb-1.5">
        {list}
      </div>
    </div>
  );

  if (stack) {
    return (
      <div className="px-3">
        <aside
          aria-label="Queued messages"
          className={composerShelfPanelClass(stackEdge)}
        >
          {header}
          {expandableList}
        </aside>
      </div>
    );
  }

  return (
    <aside
      aria-label="Queued messages"
      className="mb-3 rounded-xl border border-border/80 bg-card px-4 py-3 shadow-sm"
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
      className="todo-item-enter flex min-w-0 items-center pl-1 text-xs leading-none"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
    </li>
  );
}
