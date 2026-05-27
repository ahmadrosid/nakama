import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateAutomationRequest } from "@tinyclaw/core/contract";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export function useAutomationsQuery() {
  return useQuery({
    queryKey: queryKeys.automations.all,
    queryFn: () => client.listAutomations(),
  });
}

export function useAutomationRunsQuery(automationId: string | null) {
  return useQuery({
    queryKey: queryKeys.automations.runs(automationId ?? ""),
    queryFn: () => client.listAutomationRuns(automationId!),
    enabled: Boolean(automationId),
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
