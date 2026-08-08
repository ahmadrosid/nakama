import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ProfileSummary, StoredTask } from "@nakama/core/contract";
import { Loader2Icon, PencilIcon, PlayIcon } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatSessionRelativeTime } from "@/lib/chat-history";
import { cn } from "@/lib/utils";

interface TaskCardProps {
  isFocused: boolean;
  isRunning: boolean;
  isStarting: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onStart: () => void;
  profile?: ProfileSummary | null;
  task: StoredTask;
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
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    disabled: isRunning || isStarting,
    id: task.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dragDisabled = isRunning || isStarting;
  const showStart = !(isRunning || isStarting);
  const profileLabel = profile?.name ?? task.profileId;

  function handleFocusKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onFocus();
    }
  }

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-card p-3",
        dragDisabled ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-60 ring-2 ring-primary/30",
        isFocused && "ring-2 ring-primary/50"
      )}
      ref={setNodeRef}
      role="button"
      style={style}
      tabIndex={dragDisabled ? -1 : 0}
      {...(dragDisabled ? {} : { ...attributes, ...listeners })}
      aria-current={isFocused ? "true" : undefined}
      onClick={onFocus}
      onKeyDown={handleFocusKeyDown}
    >
      <div className="flex items-start gap-2">
        <h3 className="line-clamp-2 min-w-0 flex-1 font-medium text-foreground text-sm">
          {task.title}
        </h3>
        {isRunning ? (
          <Loader2Icon
            aria-label="Running"
            className="size-4 shrink-0 text-amber-600 motion-safe:animate-spin motion-reduce:animate-none dark:text-amber-400"
          />
        ) : isStarting ? (
          <Spinner className="size-4 shrink-0" />
        ) : null}
      </div>

      {task.description ? (
        <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
          {task.description}
        </p>
      ) : null}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-muted-foreground text-xs">
          <span>{profileLabel}</span>
          <span aria-hidden> · </span>
          <time dateTime={task.updatedAt}>
            {formatSessionRelativeTime(task.updatedAt)}
          </time>
        </p>

        <div
          className="flex shrink-0 items-center gap-0.5"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {showStart ? (
            <Button
              aria-label={`Start ${task.title}`}
              className="text-primary hover:bg-primary/10 hover:text-primary"
              onClick={() => onStart()}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <PlayIcon aria-hidden className="size-3" />
            </Button>
          ) : null}
          <Button
            aria-label={`Edit ${task.title}`}
            onClick={() => onOpen()}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <PencilIcon aria-hidden className="size-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
