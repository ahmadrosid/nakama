import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateNotificationDestinationRequest,
  UpdateNotificationDestinationRequest,
} from "@nakama/core/contract";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const notificationDestinationsQueryOptions = queryOptions({
  queryKey: queryKeys.notificationDestinations.all,
  queryFn: () => client.listNotificationDestinations(),
});

export function useNotificationDestinations() {
  return useQuery(notificationDestinationsQueryOptions);
}

export function useCreateNotificationDestination() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateNotificationDestinationRequest) =>
      client.createNotificationDestination(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notificationDestinations.all });
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
      queryClient.invalidateQueries({ queryKey: queryKeys.notificationDestinations.all });
    },
  });
}

export function useRegenerateNotificationDestinationKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (destinationId: string) =>
      client.regenerateNotificationDestinationKey(destinationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notificationDestinations.all });
    },
  });
}

export function useDeleteNotificationDestination() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (destinationId: string) => client.deleteNotificationDestination(destinationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notificationDestinations.all });
    },
  });
}
