import type { StoredTask, TaskStatus } from "@tinyclaw/core/contract";
import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CreateTaskDialog } from "@/components/tasks/CreateTaskDialog";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { TaskRunHistoryPanel } from "@/components/tasks/TaskRunHistoryPanel";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useCreateTaskMutation,
  useDeleteTaskMutation,
  useRunTaskMutation,
  useTaskRunsQuery,
  useTasksQuery,
  useUpdateTaskMutation,
} from "@/hooks/use-tasks";
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

function isHistoryTask(task: StoredTask | null): task is StoredTask {
  return task?.status === "done" || task?.status === "failed";
}

export function TasksPage() {
  const {
    data: tasks = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useTasksQuery();
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

  const {
    data: detailRuns = [],
    isLoading: detailRunsLoading,
  } = useTaskRunsQuery(detailTask?.id ?? null);

  const runningTaskIds = useMemo(() => {
    return new Set(tasks.filter((task) => task.status === "in_progress").map((task) => task.id));
  }, [tasks]);

  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    runMutation.isPending;

  useEffect(() => {
    if (focusedTaskId && !focusedTask) {
      setFocusedTaskId(null);
    }
  }, [focusedTask, focusedTaskId]);

  async function handleMoveTask(taskId: string, status: TaskStatus, position: number) {
    setPageError(null);

    try {
      await updateMutation.mutateAsync({
        taskId,
        input: { status, position },
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
        title: input.title,
        description: input.description,
        prompt: input.prompt,
        profileId: input.profileId,
      });
    } catch (createError) {
      setPageError(formatError(createError));
      throw createError;
    }
  }

  async function handleSave(input: { title: string; description: string; prompt: string }) {
    if (!detailTask) {
      return;
    }

    setPageError(null);

    try {
      const updated = await updateMutation.mutateAsync({
        taskId: detailTask.id,
        input,
      });
      setDetailTask(updated);
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
      return;
    }

    setFocusedTaskId(null);
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        showHistoryPanel && "lg:flex-row lg:overflow-hidden",
      )}
    >
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-6",
          showHistoryPanel && "bg-muted/10 lg:border-r lg:border-border/50",
        )}
      >
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="type-page-title">Tasks</h1>
            <p className="type-body max-w-2xl text-muted-foreground">
              Agent swarm board. Start a task with the play button; click a done or failed task to
              open its chat on the right.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              {isFetching ? (
                <Spinner className="size-4" />
              ) : (
                <RefreshCwIcon className="size-4" aria-hidden />
              )}
              Refresh
            </Button>
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" aria-hidden />
              New task
            </Button>
          </div>
        </header>

        <div className="mt-6 space-y-6">
          {pageError || error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-200">
              {pageError ?? formatError(error)}
            </div>
          ) : null}

          {isLoading && tasks.length === 0 ? (
            <div className="flex min-h-96 items-center justify-center">
              <Spinner className="size-6" />
            </div>
          ) : (
            <div
              className={cn(
                showHistoryPanel &&
                  "rounded-xl border border-border/70 bg-card/40 p-3 shadow-sm",
              )}
            >
              <TaskBoard
                tasks={tasks}
                runningTaskIds={runningTaskIds}
                startingTaskId={startingTaskId}
                focusedTaskId={focusedTaskId}
                onMoveTask={handleMoveTask}
                onFocusTask={handleFocusTask}
                onOpenTask={setDetailTask}
                onStartTask={handleStartTask}
              />
            </div>
          )}
        </div>
      </div>

      {showHistoryPanel && focusedTask ? (
        <TaskRunHistoryPanel task={focusedTask} onClose={() => setFocusedTaskId(null)} />
      ) : null}

      <CreateTaskDialog
        open={createOpen}
        profiles={profiles}
        busy={createMutation.isPending}
        onOpenChange={setCreateOpen}
        onCreate={handleCreate}
      />

      <TaskDetailDialog
        task={detailTask}
        runs={detailRuns}
        runsLoading={detailRunsLoading}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) {
            setDetailTask(null);
          }
        }}
        onSave={handleSave}
        onDelete={handleDelete}
        onRun={() => handleRun()}
      />
    </div>
  );
}
