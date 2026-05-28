import type { StoredTask } from "@tinyclaw/core/contract";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BotIcon, Loader2Icon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatSessionRelativeTime } from "@/lib/chat-history";
import { cn } from "@/lib/utils";

interface TaskCardProps {
  task: StoredTask;
  isRunning: boolean;
  isStarting: boolean;
  isFocused: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onStart: () => void;
}

export function TaskCard({
  task,
  isRunning,
  isStarting,
  isFocused,
  onFocus,
  onOpen,
  onStart,
}: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: isRunning || isStarting,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const showStart = !isRunning && !isStarting;

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={cn(
        "cursor-grab rounded-md border border-border bg-card p-3 shadow-sm active:cursor-grabbing",
        isDragging && "opacity-60 ring-2 ring-primary/30",
        isFocused && "ring-2 ring-primary/50",
        (isRunning || isStarting) && "cursor-default opacity-90",
      )}
      {...attributes}
      {...listeners}
      onClick={onFocus}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-sm font-medium text-foreground">{task.title}</h3>
        {isRunning ? (
          <Loader2Icon className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
        ) : isStarting ? (
          <Spinner className="size-4 shrink-0" />
        ) : null}
      </div>

      {task.description ? (
        <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <BotIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate text-xs text-muted-foreground">{task.profileId}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {showStart ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-primary hover:text-primary"
              aria-label={`Start task ${task.title}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onStart();
              }}
            >
              <PlayIcon className="size-3.5" aria-hidden />
            </Button>
          ) : null}
          <time className="text-[11px] text-muted-foreground" dateTime={task.updatedAt}>
            {formatSessionRelativeTime(task.updatedAt)}
          </time>
        </div>
      </div>
    </article>
  );
}
