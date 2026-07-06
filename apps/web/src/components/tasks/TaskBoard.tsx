import type { ProfileSummary, StoredTask, TaskStatus } from "@nakama/core/contract";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMemo, useState } from "react";
import { TaskCard } from "./TaskCard";
import { TaskColumn } from "./TaskColumn";
import { TASK_COLUMNS } from "@/hooks/use-tasks";

interface TaskBoardProps {
  tasks: StoredTask[];
  profileById: Map<string, ProfileSummary>;
  runningTaskIds: Set<string>;
  startingTaskId: string | null;
  focusedTaskId: string | null;
  onMoveTask: (taskId: string, status: TaskStatus, position: number) => void;
  onFocusTask: (task: StoredTask) => void;
  onOpenTask: (task: StoredTask) => void;
  onStartTask: (task: StoredTask) => void;
}

export function TaskBoard({
  tasks,
  profileById,
  runningTaskIds,
  startingTaskId,
  focusedTaskId,
  onMoveTask,
  onFocusTask,
  onOpenTask,
  onStartTask,
}: TaskBoardProps) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const tasksByColumn = useMemo(() => {
    const grouped = Object.fromEntries(
      TASK_COLUMNS.map((column) => [column.id, [] as StoredTask[]]),
    ) as Record<TaskStatus, StoredTask[]>;

    for (const task of tasks) {
      grouped[task.status]?.push(task);
    }

    for (const column of TASK_COLUMNS) {
      grouped[column.id].sort((left, right) => left.position - right.position);
    }

    return grouped;
  }, [tasks]);

  const activeTask = activeTaskId ? tasks.find((task) => task.id === activeTaskId) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveTaskId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTaskId(null);

    const taskId = String(event.active.id);
    const overId = event.over?.id;

    if (!overId) {
      return;
    }

    const task = tasks.find((item) => item.id === taskId);

    if (!task) {
      return;
    }

    const overTask = tasks.find((item) => item.id === overId);
    const targetStatus = (overTask?.status ?? overId) as TaskStatus;
    const columnTasks = tasksByColumn[targetStatus] ?? [];
    const overIndex = overTask
      ? columnTasks.findIndex((item) => item.id === overTask.id)
      : columnTasks.length;

    onMoveTask(taskId, targetStatus, Math.max(0, overIndex));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scroll-smooth [-webkit-overflow-scrolling:touch]"
        role="region"
        aria-label="Agent swarm kanban board"
      >
        {TASK_COLUMNS.map((column) => (
          <TaskColumn
            key={column.id}
            id={column.id}
            label={column.label}
            tasks={tasksByColumn[column.id]}
            profileById={profileById}
            runningTaskIds={runningTaskIds}
            startingTaskId={startingTaskId}
            focusedTaskId={focusedTaskId}
            onFocusTask={onFocusTask}
            onOpenTask={onOpenTask}
            onStartTask={onStartTask}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="w-72">
            <TaskCard
              task={activeTask}
              profile={profileById.get(activeTask.profileId) ?? null}
              isRunning={runningTaskIds.has(activeTask.id)}
              isStarting={startingTaskId === activeTask.id}
              isFocused={focusedTaskId === activeTask.id}
              onFocus={() => undefined}
              onOpen={() => undefined}
              onStart={() => undefined}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
