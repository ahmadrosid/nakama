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
import { invalidateQueries } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

const notificationDestinationsQueryOptions = (orgId: string) =>
  queryOptions({
    queryFn: () => client.forOrg(orgId).listNotificationDestinations(),
    queryKey: queryKeys.notificationDestinations(orgId),
  });

export function useNotificationDestinations(orgId: string) {
  return useQuery({
    ...notificationDestinationsQueryOptions(orgId),
    enabled: Boolean(orgId),
  });
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

export function useCreateNotificationDestination(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateNotificationDestinationRequest) =>
      client.forOrg(orgId).createNotificationDestination(request),
    onSuccess: () => {
      invalidateQueries(queryClient, queryKeys.notificationDestinations(orgId));
    },
  });
}

export function useUpdateNotificationDestination(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      destinationId,
      request,
    }: {
      destinationId: string;
      request: UpdateNotificationDestinationRequest;
    }) =>
      client
        .forOrg(orgId)
        .updateNotificationDestination(destinationId, request),
    onSuccess: () => {
      invalidateQueries(queryClient, queryKeys.notificationDestinations(orgId));
    },
  });
}

export function useRegenerateNotificationDestinationKey(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (destinationId: string) =>
      client.forOrg(orgId).regenerateNotificationDestinationKey(destinationId),
    onSuccess: () => {
      invalidateQueries(queryClient, queryKeys.notificationDestinations(orgId));
    },
  });
}

export function useDeleteNotificationDestination(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (destinationId: string) =>
      client.forOrg(orgId).deleteNotificationDestination(destinationId),
    onSuccess: () => {
      invalidateQueries(queryClient, queryKeys.notificationDestinations(orgId));
    },
  });
}
