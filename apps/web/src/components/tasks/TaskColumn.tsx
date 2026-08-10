import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type {
  ProfileSummary,
  StoredTask,
  TaskStatus,
} from "@nakama/core/contract";
import { TASK_COLUMN_META_BY_ID } from "@/lib/task-board";
import { cn } from "@/lib/utils";
import { TaskCard } from "./TaskCard";

interface TaskColumnProps {
  focusedTaskId: string | null;
  id: TaskStatus;
  label: string;
  onFocusTask: (task: StoredTask) => void;
  onOpenTask: (task: StoredTask) => void;
  onStartTask: (task: StoredTask) => void;
  profileById: Map<string, ProfileSummary>;
  runningTaskIds: Set<string>;
  startingTaskId: string | null;
  tasks: StoredTask[];
}

export function TaskColumn({
  id,
  label,
  tasks,
  profileById,
  runningTaskIds,
  startingTaskId,
  focusedTaskId,
  onFocusTask,
  onOpenTask,
  onStartTask,
}: TaskColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const meta = TASK_COLUMN_META_BY_ID[id];
  const ColumnIcon = meta.icon;
  const hasRunning =
    id === "in_progress" &&
    tasks.some(
      (task) => runningTaskIds.has(task.id) || task.status === "in_progress"
    );

  return (
    <section
      aria-label={`${label} column, ${tasks.length} tasks`}
      className={cn(
        "flex min-h-[20rem] w-[min(100%,18rem)] shrink-0 snap-start flex-col rounded-lg border border-border bg-muted/20 sm:min-h-[24rem] sm:w-72",
        isOver && "ring-2 ring-primary/40",
        hasRunning && "bg-amber-500/[0.03] dark:bg-amber-400/[0.04]"
      )}
    >
      <header className="space-y-0.5 border-border/80 border-b px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <ColumnIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground",
                hasRunning && "text-amber-600 dark:text-amber-400",
                hasRunning &&
                  "motion-safe:animate-spin motion-reduce:animate-none"
              )}
            />
            <h2 className="truncate font-semibold text-foreground text-sm">
              {label}
            </h2>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 font-medium text-xs tabular-nums",
              meta.countBadge
            )}
          >
            {tasks.length}
          </span>
        </div>
        <p className="line-clamp-2 text-[11px] text-muted-foreground leading-snug">
          {meta.description}
        </p>
      </header>

      <div
        className="flex min-h-[12rem] flex-1 flex-col gap-2 overflow-y-auto p-2"
        ref={setNodeRef}
      >
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-md border border-border/80 border-dashed bg-background/40 px-3 py-8 text-center">
              <ColumnIcon
                aria-hidden
                className="mb-2 size-5 text-muted-foreground/50"
              />
              <p className="text-muted-foreground text-xs leading-relaxed">
                {meta.emptyMessage}
              </p>
            </div>
          ) : (
            tasks.map((task) => (
              <TaskCard
                isFocused={focusedTaskId === task.id}
                isRunning={
                  runningTaskIds.has(task.id) || task.status === "in_progress"
                }
                isStarting={startingTaskId === task.id}
                key={task.id}
                onFocus={() => onFocusTask(task)}
                onOpen={() => onOpenTask(task)}
                onStart={() => onStartTask(task)}
                profile={profileById.get(task.profileId) ?? null}
                task={task}
              />
            ))
          )}
        </SortableContext>
      </div>
    </section>
  );
}
