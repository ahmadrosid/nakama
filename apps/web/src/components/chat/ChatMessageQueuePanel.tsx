import { FileTextIcon, PaperclipIcon } from "lucide-react";
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

export function ChatMessageQueuePanel({
  messages,
  stack = false,
}: ChatMessageQueuePanelProps) {
  if (messages.length === 0) {
    return null;
  }

  const content = (
    <ul className="space-y-2 border-t border-border/60 px-3 pb-3 pt-2.5">
      {messages.map((message, index) => (
        <li key={message.id} className="flex items-start gap-2.5 text-xs">
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] font-medium text-muted-foreground">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            {message.text ? (
              <p className="line-clamp-3 whitespace-pre-wrap text-foreground">{message.text}</p>
            ) : null}
            {message.attachmentCount > 0 ? (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                {message.text ? (
                  <PaperclipIcon className="size-3 shrink-0" aria-hidden />
                ) : (
                  <FileTextIcon className="size-3 shrink-0" aria-hidden />
                )}
                <span>
                  {message.attachmentCount} attachment
                  {message.attachmentCount === 1 ? "" : "s"}
                </span>
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );

  if (stack) {
    return (
      <div className="px-3">
        <aside
          className={cn(
            "relative z-0 w-full shrink-0 overflow-hidden rounded-t-xl rounded-b-none border border-b-0 border-border bg-card shadow-xs",
          )}
          aria-label="Queued messages"
        >
          <div className="px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">
              QUEUED {messages.length > 1 ? `(${messages.length})` : ""}
            </p>
          </div>
          {content}
        </aside>
      </div>
    );
  }

  return (
    <aside
      className="mb-3 rounded-xl border border-border/80 bg-card px-4 py-3 shadow-sm"
      aria-label="Queued messages"
    >
      <h3 className="type-label mb-1 text-muted-foreground">
        Queued {messages.length > 1 ? `(${messages.length})` : ""}
      </h3>
      {content}
    </aside>
  );
}
