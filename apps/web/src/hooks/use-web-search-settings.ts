import type { UpdateWebSearchSettingsRequest } from "@nakama/core/contract";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

const webSearchSettingsQueryOptions = queryOptions({
  queryFn: () => client.getWebSearchSettings(),
  queryKey: queryKeys.webSearchSettings,
});

export function useWebSearchSettings() {
  return useQuery(webSearchSettingsQueryOptions);
}

export function useSaveWebSearchSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateWebSearchSettingsRequest) =>
      client.setWebSearchSettings(request),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.webSearchSettings, saved);
    },
  });
}
