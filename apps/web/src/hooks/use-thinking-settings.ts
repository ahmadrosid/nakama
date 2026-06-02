import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ThinkingEffort, ThinkingSettings, UpdateThinkingRequest } from "@tinyclaw/core/contract";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export function useThinkingSettings() {
  return useQuery({
    queryKey: queryKeys.thinkingSettings,
    queryFn: () => client.getThinkingSettings(),
  });
}

export function useSaveThinkingSettings() {
  const queryClient = useQueryClient();

  return useMutation<ThinkingSettings, Error, UpdateThinkingRequest>({
    mutationFn: (settings) => client.setThinkingSettings(settings),
    onSuccess: (thinking) => {
      queryClient.setQueryData<ThinkingSettings>(queryKeys.thinkingSettings, thinking);
    },
  });
}

export function isThinkingEffort(value: string | null): value is ThinkingEffort {
  if (value == null) {
    return false;
  }

  return value === "low" || value === "medium" || value === "high";
}
