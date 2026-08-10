import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const imageGenerationSettingsQueryOptions = queryOptions({
  queryFn: () => client.getImageGenerationSettings(),
  queryKey: queryKeys.imageGenerationSettings,
});

export function useImageGenerationSettings() {
  return useQuery(imageGenerationSettingsQueryOptions);
}

export function useSaveImageGenerationSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (model: string | null) =>
      client.setImageGenerationSettings(model),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.imageGenerationSettings, saved);
    },
  });
}
