import type {
  UpdateWorkflowRequest,
  WorkflowRunRecord,
} from "@nakama/core/contract";
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

export function useWorkflowSqliteQuery(table: string | null, enabled: boolean) {
  const { isAuthenticated, isLoading } = useAuth();

  return useQuery({
    enabled: enabled && isAuthenticated && !isLoading,
    queryFn: () => client.inspectWorkflowSqlite(table ?? undefined),
    queryKey: queryKeys.workflows.database.table(table),
  });
}

const RUN_POLL_INTERVAL_MS = 2000;

/**
 * A run settles on the server, so the panel has to ask. Poll while one is in
 * flight and stop as soon as none is, which keeps a finished workflow at zero
 * requests without holding a second stream open for the page.
 */
export function workflowRunsRefetchInterval(
  runs: WorkflowRunRecord[] | undefined
): number | false {
  const running = runs?.some((run) => run.status === "running") ?? false;
  return running ? RUN_POLL_INTERVAL_MS : false;
}

export function useWorkflowRunsQuery(workflowId: string | null) {
  return useQuery({
    enabled: Boolean(workflowId),
    queryFn: () => client.listWorkflowRuns(workflowId!),
    queryKey: queryKeys.workflows.runs(workflowId ?? ""),
    refetchInterval: (query) => workflowRunsRefetchInterval(query.state.data),
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
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflows.database.all,
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
