import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateAutomationRequest } from "@nakama/core/contract";
import { useAuth } from "@/context/auth-context";
import { automationsQueryOptions } from "@/hooks/use-app-queries";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export function useAutomationsQuery() {
  const { isAuthenticated, isLoading } = useAuth();

  return useQuery({
    ...automationsQueryOptions,
    enabled: isAuthenticated && !isLoading,
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
    queryKey: queryKeys.automations.runs(automationId ?? ""),
    queryFn: () => client.listAutomationRuns(automationId!),
    enabled: Boolean(automationId),
  });
}

export function useMarkAutomationRunsReadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (automationId: string) => client.markAutomationRunsRead(automationId),
    onSuccess: async (_readThroughAt, automationId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.automations.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.automations.runs(automationId) }),
      ]);
    },
  });
}

export function useDeleteAutomationRunMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ automationId, runId }: { automationId: string; runId: string }) =>
      client.deleteAutomationRun(automationId, runId),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.automations.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.automations.runs(variables.automationId),
        }),
      ]);
    },
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
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.automations.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.automations.runs(variables.automationId),
        }),
      ]);
    },
  });
}

export function useDeleteAutomationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (automationId: string) => client.deleteAutomation(automationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.automations.all });
    },
  });
}

export function useRunAutomationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (automationId: string) => client.runAutomation(automationId),
    onSuccess: async (_data, automationId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.automations.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.automations.runs(automationId) }),
      ]);
    },
  });
}
