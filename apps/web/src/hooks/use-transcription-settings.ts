import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const transcriptionSettingsQueryOptions = queryOptions({
  queryFn: () => client.getTranscriptionSettings(),
  queryKey: queryKeys.transcriptionSettings,
});

export function useTranscriptionSettings() {
  return useQuery(transcriptionSettingsQueryOptions);
}

export function useSaveTranscriptionSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (model: string | null) =>
      client.setTranscriptionSettings(model),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.transcriptionSettings, saved);
    },
  });
}
