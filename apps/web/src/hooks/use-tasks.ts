import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateTaskRequest, TaskStatus, UpdateTaskRequest } from "@tinyclaw/core/contract";
import { client } from "@/lib/client";
import { loadTaskMessages } from "@/lib/task-messages";
import { queryKeys } from "@/lib/query-keys";

export function useTasksQuery() {
  return useQuery({
    queryKey: queryKeys.tasks.all,
    queryFn: () => client.listTasks(),
    refetchInterval: (query) => {
      const tasks = query.state.data ?? [];
      return tasks.some((task) => task.status === "in_progress") ? 3000 : false;
    },
  });
}

export function useTaskRunsQuery(taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.tasks.runs(taskId ?? ""),
    queryFn: () => client.listTaskRuns(taskId!),
    enabled: Boolean(taskId),
  });
}

export function useTaskMessagesQuery(taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.tasks.messages(taskId ?? ""),
    queryFn: () => loadTaskMessages(taskId!),
    enabled: Boolean(taskId),
  });
}

export function useCreateTaskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTaskRequest) => client.createTask(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

export function useUpdateTaskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      input,
    }: {
      taskId: string;
      input: UpdateTaskRequest;
    }) => client.updateTask(taskId, input),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.tasks.runs(variables.taskId),
        }),
      ]);
    },
  });
}

export function useDeleteTaskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) => client.deleteTask(taskId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

export function useRunTaskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) => client.runTask(taskId),
    onSuccess: async (_data, taskId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.runs(taskId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.messages(taskId) }),
      ]);
    },
  });
}

export const TASK_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "done", label: "Done" },
  { id: "failed", label: "Failed" },
];
