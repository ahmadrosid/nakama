import type { ThinkingEffort, UpdateThinkingRequest } from "@nakama/core/contract";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const thinkingSettingsQueryOptions = queryOptions({
  queryKey: queryKeys.thinkingSettings,
  queryFn: () => client.getThinkingSettings(),
});

export function buildThinkingSettingsPayload(
  effort: ThinkingEffort,
): UpdateThinkingRequest {
  return {
    enabled: true,
    effort,
  };
}

export function useThinkingSettings() {
  return useQuery(thinkingSettingsQueryOptions);
}

export function useSaveThinkingSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: UpdateThinkingRequest) => client.setThinkingSettings(settings),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.thinkingSettings, saved);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.thinkingSettings });
    },
  });
}
