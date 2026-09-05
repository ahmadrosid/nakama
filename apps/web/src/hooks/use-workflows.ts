import type { UpdateWorkflowRequest } from "@nakama/core/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export function useWorkflowsQuery() {
  const { isAuthenticated, isLoading } = useAuth();

  return useQuery({
    enabled: isAuthenticated && !isLoading,
    queryFn: () => client.listWorkflows(),
    queryKey: queryKeys.workflows.all,
    select: (data) => data.workflows,
  });
}

export function useWorkflowRunsQuery(workflowId: string | null) {
  return useQuery({
    enabled: Boolean(workflowId),
    queryFn: () => client.listWorkflowRuns(workflowId!),
    queryKey: queryKeys.workflows.runs(workflowId ?? ""),
  });
}

export function useRunWorkflowMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      input,
      workflowId,
    }: {
      workflowId: string;
      input?: Record<string, unknown>;
    }) => client.runWorkflow(workflowId, { input }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workflows.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflows.runs(variables.workflowId),
        }),
      ]);
    },
  });
}

export function useUpdateWorkflowMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      input,
      workflowId,
    }: {
      workflowId: string;
      input: UpdateWorkflowRequest;
    }) => client.updateWorkflow(workflowId, input),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workflows.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflows.runs(variables.workflowId),
        }),
      ]);
    },
  });
}

export function useDeleteWorkflowMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workflowId: string) => client.deleteWorkflow(workflowId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.all,
      });
    },
  });
}
