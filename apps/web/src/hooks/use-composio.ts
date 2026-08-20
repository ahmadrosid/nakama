import type {
  UpdateComposioSettingsRequest,
  UpdateProfileComposioToolkitsRequest,
} from "@nakama/core/contract";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export const composioSettingsQueryOptions = queryOptions({
  queryFn: () => client.getComposioSettings(),
  queryKey: queryKeys.composio.settings,
});

export function useComposioSettings() {
  return useQuery(composioSettingsQueryOptions);
}

export function useSaveComposioSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateComposioSettingsRequest) =>
      client.setComposioSettings(request),
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKeys.composio.settings, saved);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.composio.toolkits,
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.health }),
      ]);
    },
  });
}

export const composioToolkitsQueryOptions = queryOptions({
  queryFn: () => client.listComposioToolkits(),
  queryKey: queryKeys.composio.toolkits,
});

export function useComposioToolkits() {
  return useQuery(composioToolkitsQueryOptions);
}

export function useEnableComposioToolkit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (toolkitSlug: string) =>
      client.enableComposioToolkit(toolkitSlug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.composio.toolkits });
    },
  });
}

export function useDisableComposioToolkit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (toolkitSlug: string) =>
      client.disableComposioToolkit(toolkitSlug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.composio.toolkits });
    },
  });
}

export function useConnectComposioToolkit() {
  return useMutation({
    mutationFn: (toolkitSlug: string) =>
      client.connectComposioToolkit(toolkitSlug),
    onSuccess: (response) => {
      // Composio hosts the account picker and consent, then redirects back to
      // /integrations through our OAuth callback.
      window.location.href = response.redirectUrl;
    },
  });
}

export function useDisconnectComposioToolkit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (toolkitSlug: string) =>
      client.disconnectComposioToolkit(toolkitSlug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.composio.toolkits });
    },
  });
}

export function useSyncComposioToolkit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (toolkitSlug: string) =>
      client.syncComposioToolkit(toolkitSlug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.composio.toolkits });
    },
  });
}

export function profileComposioToolkitsQueryOptions(profileId: string | null) {
  return queryOptions({
    enabled: Boolean(profileId),
    queryFn: () => client.listProfileComposioToolkits(profileId!),
    queryKey: queryKeys.composio.profileToolkits(profileId ?? "none"),
  });
}

export function useProfileComposioToolkits(profileId: string | null) {
  return useQuery(profileComposioToolkitsQueryOptions(profileId));
}

export function useUpdateProfileComposioToolkitsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      assignments,
    }: {
      profileId: string;
      assignments: UpdateProfileComposioToolkitsRequest["assignments"];
    }) => client.updateProfileComposioToolkits(profileId, { assignments }),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.composio.profileToolkits(variables.profileId),
      });
    },
  });
}
