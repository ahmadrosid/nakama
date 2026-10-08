import type { UpdateAutomationRequest } from "@nakama/core/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { automationsQueryOptions } from "@/hooks/use-app-queries";
import { client } from "@/lib/client";
import { invalidateQueries } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

export function useAutomationsQuery(refetchInterval = 30_000) {
  const { isAuthenticated, isLoading } = useAuth();

  return useQuery({
    ...automationsQueryOptions,
    enabled: isAuthenticated && !isLoading,
    refetchInterval,
  });
}

export function useAutomationUnreadTotal() {
  const { isAuthenticated, isLoading } = useAuth();

  return useQuery({
    ...automationsQueryOptions,
    enabled: isAuthenticated && !isLoading,
    select: (data) => data.unread?.totalUnread ?? 0,
  });
}

export function useAutomationRunsQuery(automationId: string | null) {
  return useQuery({
    enabled: Boolean(automationId),
    queryFn: () => client.listAutomationRuns(automationId!),
    queryKey: queryKeys.automations.runs(automationId ?? ""),
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.status === "running") ? 1000 : 5000,
  });
}

function invalidateAutomationQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  automationId: string
) {
  return invalidateQueries(
    queryClient,
    queryKeys.automations.all,
    queryKeys.automations.runs(automationId)
  );
}

export function useMarkAutomationRunsReadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (automationId: string) =>
      client.markAutomationRunsRead(automationId),
    onSuccess: (_readThroughAt, automationId) =>
      invalidateAutomationQueries(queryClient, automationId),
  });
}

export function useDeleteAutomationRunMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      automationId,
      runId,
    }: {
      automationId: string;
      runId: string;
    }) => client.deleteAutomationRun(automationId, runId),
    onSuccess: (_data, variables) =>
      invalidateAutomationQueries(queryClient, variables.automationId),
  });
}

export function useUpdateAutomationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      automationId,
      input,
    }: {
      automationId: string;
      input: UpdateAutomationRequest;
    }) => client.updateAutomation(automationId, input),
    onSuccess: (_data, variables) =>
      invalidateAutomationQueries(queryClient, variables.automationId),
  });
}

export function useDeleteAutomationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (automationId: string) => client.deleteAutomation(automationId),
    onSuccess: () => invalidateQueries(queryClient, queryKeys.automations.all),
  });
}

export function useRunAutomationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (automationId: string) => client.runAutomation(automationId),
    onSuccess: (_data, automationId) =>
      invalidateAutomationQueries(queryClient, automationId),
  });
}
