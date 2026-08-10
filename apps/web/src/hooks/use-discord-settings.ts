import type { UpdateDiscordSettingsRequest } from "@nakama/core/contract";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const discordSettingsQueryOptions = queryOptions({
  queryFn: () => client.getDiscordSettings(),
  queryKey: queryKeys.discord.settings,
});

export function useDiscordSettings() {
  return useQuery(discordSettingsQueryOptions);
}

export function useSaveDiscordSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateDiscordSettingsRequest) =>
      client.setDiscordSettings(request),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.discord.settings, saved);
    },
  });
}

export function useRegenerateDiscordHandshake() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.regenerateDiscordHandshake(),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.discord.settings, saved);
    },
  });
}
