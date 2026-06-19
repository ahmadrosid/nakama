import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const visionSettingsQueryOptions = queryOptions({
  queryKey: queryKeys.visionSettings,
  queryFn: () => client.getVisionSettings(),
});

export function useVisionSettings() {
  return useQuery(visionSettingsQueryOptions);
}

export function useSaveVisionSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (model: string | null) => client.setVisionSettings(model),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.visionSettings, saved);
    },
  });
}
