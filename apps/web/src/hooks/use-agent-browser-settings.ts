import type { AgentBrowserStatusResponse } from "@nakama/core/contract";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

const agentBrowserSettingsQueryOptions = queryOptions({
  queryFn: () => client.getAgentBrowserStatus(),
  queryKey: queryKeys.agentBrowser.settings,
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
    mutationFn: async (
      options: {
        onProgress?: (message: string) => void;
        cliOnly?: boolean;
      } = {}
    ) => client.installAgentBrowser(options),
    onSuccess: (saved: AgentBrowserStatusResponse) => {
      queryClient.setQueryData(queryKeys.agentBrowser.settings, saved);
    },
  });
}
