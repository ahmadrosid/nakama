import type {
  CreateNotificationDestinationRequest,
  UpdateNotificationDestinationRequest,
} from "@nakama/core/contract";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const notificationDestinationsQueryOptions = queryOptions({
  queryFn: () => client.listNotificationDestinations(),
  queryKey: queryKeys.notificationDestinations.all,
});

export function useNotificationDestinations() {
  return useQuery(notificationDestinationsQueryOptions);
}

export function useNotificationWhatsAppSettings(
  profileId: string,
  enabled: boolean
) {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id ?? null;
  return useQuery({
    enabled: enabled && !!orgId && !!profileId,
    queryFn: () => client.forOrg(orgId).getWhatsAppSettings(profileId),
    queryKey: [...queryKeys.whatsapp.settings, orgId, profileId],
  });
}

export function useCreateNotificationDestination() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateNotificationDestinationRequest) =>
      client.createNotificationDestination(request),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationDestinations.all,
      });
    },
  });
}

export function useUpdateNotificationDestination() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      destinationId,
      request,
    }: {
      destinationId: string;
      request: UpdateNotificationDestinationRequest;
    }) => client.updateNotificationDestination(destinationId, request),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationDestinations.all,
      });
    },
  });
}

export function useRegenerateNotificationDestinationKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (destinationId: string) =>
      client.regenerateNotificationDestinationKey(destinationId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationDestinations.all,
      });
    },
  });
}

export function useDeleteNotificationDestination() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (destinationId: string) =>
      client.deleteNotificationDestination(destinationId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationDestinations.all,
      });
    },
  });
}
