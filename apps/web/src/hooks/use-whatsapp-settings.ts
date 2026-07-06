import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { UpdateWhatsAppSettingsRequest } from "@nakama/core/contract";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const whatsappSettingsQueryOptions = queryOptions({
  queryKey: queryKeys.whatsapp.settings,
  queryFn: () => client.getWhatsAppSettings(),
});

export function useWhatsAppSettings() {
  return useQuery(whatsappSettingsQueryOptions);
}

export function useSaveWhatsAppSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateWhatsAppSettingsRequest) =>
      client.setWhatsAppSettings(request),
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKeys.whatsapp.settings, saved);
      await queryClient.invalidateQueries({ queryKey: queryKeys.systemStatus });
    },
  });
}

export function useRegenerateWhatsAppPairingCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.regenerateWhatsAppPairingCode(),
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKeys.whatsapp.settings, saved);
      await queryClient.invalidateQueries({ queryKey: queryKeys.systemStatus });
    },
  });
}

export function useReconnectWhatsApp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.reconnectWhatsApp(),
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKeys.whatsapp.settings, saved);
      await queryClient.invalidateQueries({ queryKey: queryKeys.systemStatus });
    },
  });
}
