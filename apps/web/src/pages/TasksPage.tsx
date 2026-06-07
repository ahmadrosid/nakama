import type { StoredTask, TaskStatus } from "@tinyclaw/core/contract";
import { AlertTriangleIcon, KanbanIcon, PlusIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { CreateTaskDialog } from "@/components/tasks/CreateTaskDialog";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { TaskBoardSkeleton } from "@/components/tasks/TaskBoardSkeleton";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { TaskRunHistoryPanel } from "@/components/tasks/TaskRunHistoryPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useCreateTaskMutation,
  useDeleteTaskMutation,
  useRunTaskMutation,
  useTasksQuery,
  useUpdateTaskMutation,
} from "@/hooks/use-tasks";
import { formatError } from "@/lib/client";
import { loadTaskMessages } from "@/lib/task-messages";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

function isHistoryTask(task: StoredTask | null): task is StoredTask {
  return task?.status === "done" || task?.status === "failed";
}

function countByStatus(tasks: StoredTask[], status: TaskStatus): number {
  return tasks.filter((task) => task.status === status).length;
}

export function TasksPage() {
  const queryClient = useQueryClient();
  const {
    data: tasks = [],
    isLoading,
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

  const runningTaskIds = useMemo(() => {
    return new Set(tasks.filter((task) => task.status === "in_progress").map((task) => task.id));
  }, [tasks]);

  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );

  const metrics = useMemo(
    () => ({
      total: tasks.length,
      inProgress: countByStatus(tasks, "in_progress"),
      done: countByStatus(tasks, "done"),
      failed: countByStatus(tasks, "failed"),
    }),
    [tasks],
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
        taskId: detailTask.id,
        input,
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
        queryKey: queryKeys.tasks.messages(task.id),
        queryFn: () => loadTaskMessages(task.id),
      });
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
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6",
          showHistoryPanel && "bg-muted/10",
        )}
      >
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
              <KanbanIcon className="size-5 text-foreground" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1">
              <h1 className="type-page-title">Agent Swarm</h1>
              <p className="type-body max-w-2xl">
                Kanban board for multi-agent work. Start tasks with play, drag across columns, and
                open done or failed cards to review run chat.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" aria-hidden />
              New task
            </Button>
          </div>
        </header>

        {!isLoading || tasks.length > 0 ? (
          <div className="@container/metrics mt-5 min-w-0">
            <div
              className={cn(
                "grid grid-cols-1 gap-2 sm:gap-3",
                "@sm/metrics:grid-cols-2 @2xl/metrics:grid-cols-4",
              )}
            >
            <SwarmMetricTile
              label="Total tasks"
              value={metrics.total}
              hint="All columns"
              compact={showHistoryPanel}
            />
            <SwarmMetricTile
              label="In progress"
              value={metrics.inProgress}
              hint="Agents currently running"
              highlight={metrics.inProgress > 0}
              compact={showHistoryPanel}
            />
            <SwarmMetricTile
              label="Completed"
              value={metrics.done}
              hint="Successful runs"
              compact={showHistoryPanel}
            />
            <SwarmMetricTile
              label="Failed"
              value={metrics.failed}
              hint="Needs attention"
              warn={metrics.failed > 0}
              compact={showHistoryPanel}
            />
            </div>
          </div>
        ) : null}

        <div className="mt-6 space-y-4">
          {errorMessage ? (
            <Card className="border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20">
              <CardContent className="flex flex-wrap items-start gap-3 p-4">
                <AlertTriangleIcon
                  className="mt-0.5 size-5 shrink-0 text-red-700 dark:text-red-300"
                  aria-hidden
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm font-medium text-red-900 dark:text-red-100">
                    Something went wrong
                  </p>
                  <p className="text-sm text-red-800 dark:text-red-200">{errorMessage}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-red-300 bg-white text-red-900 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100 dark:hover:bg-red-950/60"
                    onClick={() => {
                      setPageError(null);
                      void refetch();
                    }}
                  >
                    Try again
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {isLoading && tasks.length === 0 ? (
            <TaskBoardSkeleton />
          ) : tasks.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
                <div className="flex size-12 items-center justify-center rounded-full border border-border bg-muted/40">
                  <KanbanIcon className="size-6 text-muted-foreground" aria-hidden />
                </div>
                <div className="max-w-sm space-y-1.5">
                  <p className="text-sm font-semibold text-foreground">No tasks yet</p>
                  <p className="text-sm text-muted-foreground">
                    Create your first swarm task to assign work to an agent profile.
                  </p>
                </div>
                <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                  <PlusIcon className="size-4" aria-hidden />
                  Create first task
                </Button>
              </CardContent>
            </Card>
          ) : (
            <TaskBoard
              tasks={tasks}
              profileById={profileById}
              runningTaskIds={runningTaskIds}
              startingTaskId={startingTaskId}
              focusedTaskId={focusedTaskId}
              onMoveTask={handleMoveTask}
              onFocusTask={handleFocusTask}
              onOpenTask={setDetailTask}
              onStartTask={handleStartTask}
            />
          )}
        </div>
      </div>

      {showHistoryPanel && focusedTask ? (
        <TaskRunHistoryPanel
          task={focusedTask}
          profile={profileById.get(focusedTask.profileId) ?? null}
          onClose={() => setFocusedTaskId(null)}
        />
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
        profiles={profiles}
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

function SwarmMetricTile({
  label,
  value,
  hint,
  highlight = false,
  warn = false,
  compact = false,
}: {
  label: string;
  value: number;
  hint: string;
  highlight?: boolean;
  warn?: boolean;
  compact?: boolean;
}) {
  return (
    <Card
      className={cn(
        "min-w-0 overflow-hidden",
        highlight && "border-amber-300/50 bg-amber-50/40 dark:border-amber-800/40 dark:bg-amber-950/20",
        warn && value > 0 && "border-red-300/50 bg-red-50/40 dark:border-red-900/40 dark:bg-red-950/20",
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 p-3 pb-1">
        <CardDescription className="min-w-0 truncate text-xs">{label}</CardDescription>
        <CardTitle
          className={cn(
            "shrink-0 tabular-nums",
            compact ? "text-lg @sm/metrics:text-xl" : "text-xl @sm/metrics:text-2xl",
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0">
        <p
          className={cn(
            "text-muted-foreground",
            compact
              ? "line-clamp-2 text-[11px] @sm/metrics:line-clamp-1 @sm/metrics:text-xs"
              : "line-clamp-2 text-xs @sm/metrics:line-clamp-1",
          )}
        >
          {hint}
        </p>
      </CardContent>
    </Card>
  );
}
