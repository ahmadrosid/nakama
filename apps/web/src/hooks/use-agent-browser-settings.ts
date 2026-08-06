import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { AgentBrowserStatusResponse } from "@nakama/core/contract";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const agentBrowserSettingsQueryOptions = queryOptions({
  queryKey: queryKeys.agentBrowser.settings,
  queryFn: () => client.getAgentBrowserStatus(),
});

export function useAgentBrowserSettings(enabled = true) {
  return useQuery({
    ...agentBrowserSettingsQueryOptions,
    enabled,
  });
}

export function useInstallAgentBrowser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (options: { onProgress?: (message: string) => void } = {}) => {
      return client.installAgentBrowser({ onProgress: options.onProgress });
    },
    onSuccess: (saved: AgentBrowserStatusResponse) => {
      queryClient.setQueryData(queryKeys.agentBrowser.settings, saved);
    },
  });
}
