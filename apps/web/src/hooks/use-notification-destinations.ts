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

export function notificationDestinationsQueryOptions(
  userId: string,
  orgId: string
) {
  return queryOptions({
    queryFn: () => client.listNotificationDestinations(),
    queryKey: queryKeys.notificationDestinations.all(userId, orgId),
  });
}

function useNotificationDestinationScope() {
  const { activeOrg, user } = useAuth();

  return user && activeOrg ? { orgId: activeOrg.id, userId: user.id } : null;
}

export function useNotificationDestinations() {
  const scope = useNotificationDestinationScope();

  return useQuery({
    ...notificationDestinationsQueryOptions(
      scope?.userId ?? "",
      scope?.orgId ?? ""
    ),
    enabled: scope !== null,
  });
}

export function useCreateNotificationDestination() {
  const queryClient = useQueryClient();
  const scope = useNotificationDestinationScope();

  return useMutation({
    mutationFn: (request: CreateNotificationDestinationRequest) =>
      client.createNotificationDestination(request),
    onSuccess: () => {
      if (scope) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notificationDestinations.all(
            scope.userId,
            scope.orgId
          ),
        });
      }
    },
  });
}

export function useUpdateNotificationDestination() {
  const queryClient = useQueryClient();
  const scope = useNotificationDestinationScope();

  return useMutation({
    mutationFn: ({
      destinationId,
      request,
    }: {
      destinationId: string;
      request: UpdateNotificationDestinationRequest;
    }) => client.updateNotificationDestination(destinationId, request),
    onSuccess: () => {
      if (scope) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notificationDestinations.all(
            scope.userId,
            scope.orgId
          ),
        });
      }
    },
  });
}

export function useRegenerateNotificationDestinationKey() {
  const queryClient = useQueryClient();
  const scope = useNotificationDestinationScope();

  return useMutation({
    mutationFn: (destinationId: string) =>
      client.regenerateNotificationDestinationKey(destinationId),
    onSuccess: () => {
      if (scope) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notificationDestinations.all(
            scope.userId,
            scope.orgId
          ),
        });
      }
    },
  });
}

export function useDeleteNotificationDestination() {
  const queryClient = useQueryClient();
  const scope = useNotificationDestinationScope();

  return useMutation({
    mutationFn: (destinationId: string) =>
      client.deleteNotificationDestination(destinationId),
    onSuccess: () => {
      if (scope) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notificationDestinations.all(
            scope.userId,
            scope.orgId
          ),
        });
      }
    },
  });
}
