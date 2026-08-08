import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  ProfileSummary,
  StoredTask,
  TaskStatus,
} from "@nakama/core/contract";
import { useMemo, useState } from "react";
import { TASK_COLUMNS } from "@/hooks/use-tasks";
import { TaskCard } from "./TaskCard";
import { TaskColumn } from "./TaskColumn";

interface TaskBoardProps {
  focusedTaskId: string | null;
  onFocusTask: (task: StoredTask) => void;
  onMoveTask: (taskId: string, status: TaskStatus, position: number) => void;
  onOpenTask: (task: StoredTask) => void;
  onStartTask: (task: StoredTask) => void;
  profileById: Map<string, ProfileSummary>;
  runningTaskIds: Set<string>;
  startingTaskId: string | null;
  tasks: StoredTask[];
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const tasksByColumn = useMemo(() => {
    const grouped = Object.fromEntries(
      TASK_COLUMNS.map((column) => [column.id, [] as StoredTask[]])
    ) as Record<TaskStatus, StoredTask[]>;

    for (const task of tasks) {
      grouped[task.status]?.push(task);
    }

    for (const column of TASK_COLUMNS) {
      grouped[column.id].sort((left, right) => left.position - right.position);
    }

    return grouped;
  }, [tasks]);

  const activeTask = activeTaskId
    ? tasks.find((task) => task.id === activeTaskId)
    : null;

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
      collisionDetection={closestCorners}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
      sensors={sensors}
    >
      <div
        aria-label="Agent swarm kanban board"
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-4 [-webkit-overflow-scrolling:touch]"
        role="region"
      >
        {TASK_COLUMNS.map((column) => (
          <TaskColumn
            focusedTaskId={focusedTaskId}
            id={column.id}
            key={column.id}
            label={column.label}
            onFocusTask={onFocusTask}
            onOpenTask={onOpenTask}
            onStartTask={onStartTask}
            profileById={profileById}
            runningTaskIds={runningTaskIds}
            startingTaskId={startingTaskId}
            tasks={tasksByColumn[column.id]}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="w-72">
            <TaskCard
              isFocused={focusedTaskId === activeTask.id}
              isRunning={runningTaskIds.has(activeTask.id)}
              isStarting={startingTaskId === activeTask.id}
              onFocus={() => undefined}
              onOpen={() => undefined}
              onStart={() => undefined}
              profile={profileById.get(activeTask.profileId) ?? null}
              task={activeTask}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
