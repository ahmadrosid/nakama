import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { UpdateTelegramSettingsRequest } from "@nakama/core/contract";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const telegramSettingsQueryOptions = queryOptions({
  queryKey: queryKeys.telegram.settings,
  queryFn: () => client.getTelegramSettings(),
});

export function useTelegramSettings() {
  return useQuery(telegramSettingsQueryOptions);
}

export function useSaveTelegramSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateTelegramSettingsRequest) =>
      client.setTelegramSettings(request),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.telegram.settings, saved);
    },
  });
}

export function useRegenerateTelegramHandshake() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.regenerateTelegramHandshake(),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.telegram.settings, saved);
    },
  });
}
