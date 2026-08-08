import type { StoredTask, TaskStatus } from "@nakama/core/contract";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CreateTaskDialog } from "@/components/tasks/CreateTaskDialog";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { TaskRunHistoryPanel } from "@/components/tasks/TaskRunHistoryPanel";
import { TasksPageBoardSection } from "@/components/tasks/tasks-page-board-section";
import { TasksPageMetrics } from "@/components/tasks/tasks-page-metrics";
import { Button } from "@/components/ui/button";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useCreateTaskMutation,
  useDeleteTaskMutation,
  useRunTaskMutation,
  useTasksQuery,
  useUpdateTaskMutation,
} from "@/hooks/use-tasks";
import { formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { loadTaskMessages } from "@/lib/task-messages";
import { cn } from "@/lib/utils";

function isHistoryTask(task: StoredTask | null): task is StoredTask {
  return task?.status === "done" || task?.status === "failed";
}

function countByStatus(tasks: StoredTask[], status: TaskStatus): number {
  return tasks.filter((task) => task.status === status).length;
}

export function TasksPage() {
  const queryClient = useQueryClient();
  const { data: tasks = [], isLoading, error, refetch } = useTasksQuery();
  const { data: profiles = [] } = useProfilesQuery();
  const createMutation = useCreateTaskMutation();
  const updateMutation = useUpdateTaskMutation();
  const deleteMutation = useDeleteTaskMutation();
  const runMutation = useRunTaskMutation();

  const [createOpen, setCreateOpen] = useState(false);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<StoredTask | null>(null);
  const [startingTaskId, setStartingTaskId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const focusedTask = tasks.find((task) => task.id === focusedTaskId) ?? null;
  const showHistoryPanel = isHistoryTask(focusedTask);

  const runningTaskIds = useMemo(() => {
    const ids = new Set<string>();

    for (const task of tasks) {
      if (task.status === "in_progress") {
        ids.add(task.id);
      }
    }

    return ids;
  }, [tasks]);

  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles]
  );

  const metrics = useMemo(
    () => ({
      done: countByStatus(tasks, "done"),
      failed: countByStatus(tasks, "failed"),
      inProgress: countByStatus(tasks, "in_progress"),
      total: tasks.length,
    }),
    [tasks]
  );

  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    runMutation.isPending;

  const errorMessage = pageError ?? (error ? formatError(error) : null);

  useEffect(() => {
    if (focusedTaskId && !focusedTask) {
      setFocusedTaskId(null);
    }
  }, [focusedTask, focusedTaskId]);

  async function handleMoveTask(
    taskId: string,
    status: TaskStatus,
    position: number
  ) {
    setPageError(null);

    try {
      await updateMutation.mutateAsync({
        input: { position, status },
        taskId,
      });
    } catch (moveError) {
      setPageError(formatError(moveError));
    }
  }

  async function handleCreate(input: {
    title: string;
    description: string;
    prompt: string;
    profileId: string;
  }) {
    setPageError(null);

    try {
      await createMutation.mutateAsync({
        description: input.description,
        profileId: input.profileId,
        prompt: input.prompt,
        title: input.title,
      });
    } catch (createError) {
      setPageError(formatError(createError));
      throw createError;
    }
  }

  async function handleSave(input: {
    title: string;
    description: string;
    prompt: string;
    profileId: string;
  }) {
    if (!detailTask) {
      return;
    }

    setPageError(null);

    try {
      await updateMutation.mutateAsync({
        input,
        taskId: detailTask.id,
      });
      setDetailTask(null);
    } catch (saveError) {
      setPageError(formatError(saveError));
    }
  }

  async function handleDelete() {
    if (!detailTask) {
      return;
    }

    setPageError(null);

    try {
      await deleteMutation.mutateAsync(detailTask.id);
      if (focusedTaskId === detailTask.id) {
        setFocusedTaskId(null);
      }
      setDetailTask(null);
    } catch (deleteError) {
      setPageError(formatError(deleteError));
    }
  }

  async function handleRun(taskId = detailTask?.id) {
    if (!taskId) {
      return;
    }

    setPageError(null);
    setStartingTaskId(taskId);

    try {
      await runMutation.mutateAsync(taskId);
      const result = await refetch();
      const updated = result.data?.find((task) => task.id === taskId);

      if (updated) {
        setFocusedTaskId(taskId);

        if (detailTask?.id === taskId) {
          setDetailTask(updated);
        }
      }
    } catch (runError) {
      setPageError(formatError(runError));
    } finally {
      setStartingTaskId(null);
    }
  }

  async function handleStartTask(task: StoredTask) {
    setFocusedTaskId(task.id);
    await handleRun(task.id);
  }

  function handleFocusTask(task: StoredTask) {
    if (isHistoryTask(task)) {
      setFocusedTaskId(task.id);
      void queryClient.fetchQuery({
        queryFn: () => loadTaskMessages(task.id),
        queryKey: queryKeys.tasks.messages(task.id),
      });
      return;
    }

    setFocusedTaskId(null);
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        showHistoryPanel && "lg:flex-row lg:overflow-hidden"
      )}
    >
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6",
          showHistoryPanel && "bg-muted/10"
        )}
      >
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="type-page-title">Agent Swarm</h1>
            <p className="type-body max-w-2xl">
              Kanban board for multi-agent work. Start tasks with play, drag
              across columns, and open done or failed cards to review run chat.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Button onClick={() => setCreateOpen(true)} size="sm" type="button">
              <PlusIcon aria-hidden className="size-4" />
              New task
            </Button>
          </div>
        </header>

        {!isLoading || tasks.length > 0 ? (
          <TasksPageMetrics compact={showHistoryPanel} metrics={metrics} />
        ) : null}

        <TasksPageBoardSection
          errorMessage={errorMessage}
          focusedTaskId={focusedTaskId}
          isLoading={isLoading}
          onCreateOpen={() => setCreateOpen(true)}
          onFocusTask={handleFocusTask}
          onMoveTask={handleMoveTask}
          onOpenTask={setDetailTask}
          onRetry={() => {
            setPageError(null);
            void refetch();
          }}
          onStartTask={handleStartTask}
          profileById={profileById}
          runningTaskIds={runningTaskIds}
          startingTaskId={startingTaskId}
          tasks={tasks}
        />
      </div>

      {showHistoryPanel && focusedTask ? (
        <TaskRunHistoryPanel
          key={focusedTask.id}
          onClose={() => setFocusedTaskId(null)}
          profile={profileById.get(focusedTask.profileId) ?? null}
          task={focusedTask}
        />
      ) : null}

      <CreateTaskDialog
        busy={createMutation.isPending}
        onCreate={handleCreate}
        onOpenChange={setCreateOpen}
        open={createOpen}
        profiles={profiles}
      />

      <TaskDetailDialog
        busy={busy}
        onDelete={handleDelete}
        onOpenChange={(open) => {
          if (!open) {
            setDetailTask(null);
          }
        }}
        onRun={() => handleRun()}
        onSave={handleSave}
        profiles={profiles}
        task={detailTask}
      />
    </div>
  );
}
