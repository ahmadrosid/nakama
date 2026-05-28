import type { StoredTask, TaskStatus } from "@tinyclaw/core/contract";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { TaskCard } from "./TaskCard";

interface TaskColumnProps {
  id: TaskStatus;
  label: string;
  tasks: StoredTask[];
  runningTaskIds: Set<string>;
  startingTaskId: string | null;
  focusedTaskId: string | null;
  onFocusTask: (task: StoredTask) => void;
  onOpenTask: (task: StoredTask) => void;
  onStartTask: (task: StoredTask) => void;
}

export function TaskColumn({
  id,
  label,
  tasks,
  runningTaskIds,
  startingTaskId,
  focusedTaskId,
  onFocusTask,
  onOpenTask,
  onStartTask,
}: TaskColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <section
      className={cn(
        "flex min-h-[24rem] w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/30",
        isOver && "ring-2 ring-primary/40",
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">{label}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {tasks.length}
        </span>
      </header>

      <div ref={setNodeRef} className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isRunning={runningTaskIds.has(task.id) || task.status === "in_progress"}
              isStarting={startingTaskId === task.id}
              isFocused={focusedTaskId === task.id}
              onFocus={() => onFocusTask(task)}
              onOpen={() => onOpenTask(task)}
              onStart={() => onStartTask(task)}
            />
          ))}
        </SortableContext>
      </div>
    </section>
  );
}
