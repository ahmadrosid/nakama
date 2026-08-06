import type { ProfileSummary, StoredTask } from "@nakama/core/contract";
import type { KeyboardEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Loader2Icon, PencilIcon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatSessionRelativeTime } from "@/lib/chat-history";
import { cn } from "@/lib/utils";

interface TaskCardProps {
  task: StoredTask;
  profile?: ProfileSummary | null;
  isRunning: boolean;
  isStarting: boolean;
  isFocused: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onStart: () => void;
}

export function TaskCard({
  task,
  profile,
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

  const dragDisabled = isRunning || isStarting;
  const showStart = !isRunning && !isStarting;
  const profileLabel = profile?.name ?? task.profileId;

  function handleFocusKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onFocus();
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="button"
      tabIndex={dragDisabled ? -1 : 0}
      className={cn(
        "rounded-md border border-border bg-card p-3",
        dragDisabled ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-60 ring-2 ring-primary/30",
        isFocused && "ring-2 ring-primary/50",
      )}
      {...(dragDisabled ? {} : { ...attributes, ...listeners })}
      onClick={onFocus}
      onKeyDown={handleFocusKeyDown}
      aria-current={isFocused ? "true" : undefined}
    >
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 line-clamp-2 text-sm font-medium text-foreground">
          {task.title}
        </h3>
        {isRunning ? (
          <Loader2Icon
            className="size-4 shrink-0 text-amber-600 motion-safe:animate-spin motion-reduce:animate-none dark:text-amber-400"
            aria-label="Running"
          />
        ) : isStarting ? (
          <Spinner className="size-4 shrink-0" />
        ) : null}
      </div>

      {task.description ? (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
      ) : null}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          <span>{profileLabel}</span>
          <span aria-hidden> · </span>
          <time dateTime={task.updatedAt}>{formatSessionRelativeTime(task.updatedAt)}</time>
        </p>

        <div
          className="flex shrink-0 items-center gap-0.5"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {showStart ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-primary hover:bg-primary/10 hover:text-primary"
              aria-label={`Start ${task.title}`}
              onClick={() => onStart()}
            >
              <PlayIcon className="size-3" aria-hidden />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Edit ${task.title}`}
            onClick={() => onOpen()}
          >
            <PencilIcon className="size-3" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
