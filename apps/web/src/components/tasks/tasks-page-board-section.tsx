import type { ProfileSummary, StoredTask, TaskStatus } from "@nakama/core/contract";
import { AlertTriangleIcon, KanbanIcon, PlusIcon } from "lucide-react";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { TaskBoardSkeleton } from "@/components/tasks/TaskBoardSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function TasksPageBoardSection({
  isLoading,
  tasks,
  errorMessage,
  profileById,
  runningTaskIds,
  startingTaskId,
  focusedTaskId,
  onRetry,
  onCreateOpen,
  onMoveTask,
  onFocusTask,
  onOpenTask,
  onStartTask,
}: {
  isLoading: boolean;
  tasks: StoredTask[];
  errorMessage: string | null;
  profileById: Map<string, ProfileSummary>;
  runningTaskIds: Set<string>;
  startingTaskId: string | null;
  focusedTaskId: string | null;
  onRetry: () => void;
  onCreateOpen: () => void;
  onMoveTask: (taskId: string, status: TaskStatus, position: number) => void;
  onFocusTask: (task: StoredTask) => void;
  onOpenTask: (task: StoredTask) => void;
  onStartTask: (task: StoredTask) => void;
}) {
  return (
    <div className="mt-6 space-y-4">
      {errorMessage ? (
        <Card className="border-red-200 bg-red-50 shadow-none dark:border-red-900/40 dark:bg-red-950/20">
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
                onClick={onRetry}
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
        <Card className="border-dashed shadow-none">
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
            <Button type="button" size="sm" onClick={onCreateOpen}>
              <PlusIcon className="size-4" data-icon="inline-start" aria-hidden />
              Create task
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
          onMoveTask={onMoveTask}
          onFocusTask={onFocusTask}
          onOpenTask={onOpenTask}
          onStartTask={onStartTask}
        />
      )}
    </div>
  );
}
