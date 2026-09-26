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
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const notificationDestinationsQueryOptions = (orgId: string) =>
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

export function useCreateNotificationDestination(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateNotificationDestinationRequest) =>
      client.forOrg(orgId).createNotificationDestination(request),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationDestinations(orgId),
      });
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
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationDestinations(orgId),
      });
    },
  });
}

export function useRegenerateNotificationDestinationKey(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (destinationId: string) =>
      client.forOrg(orgId).regenerateNotificationDestinationKey(destinationId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationDestinations(orgId),
      });
    },
  });
}

export function useDeleteNotificationDestination(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (destinationId: string) =>
      client.forOrg(orgId).deleteNotificationDestination(destinationId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationDestinations(orgId),
      });
    },
  });
}
