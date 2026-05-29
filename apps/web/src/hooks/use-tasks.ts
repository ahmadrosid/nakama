import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateTaskRequest, UpdateTaskRequest } from "@tinyclaw/core/contract";
import { client } from "@/lib/client";
import { TASK_COLUMN_META } from "@/lib/task-board";
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

export function useTaskMessagesQuery(taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.tasks.messages(taskId ?? ""),
    queryFn: () => loadTaskMessages(taskId!),
    enabled: Boolean(taskId),
  });
}

export function useDraftTaskPromptMutation() {
  return useMutation({
    mutationFn: (input: { title: string; description?: string }) => client.draftTaskPrompt(input),
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
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
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.messages(taskId) }),
      ]);
    },
  });
}

export const TASK_COLUMNS = TASK_COLUMN_META.map((column) => ({
  id: column.id,
  label: column.label,
}));
