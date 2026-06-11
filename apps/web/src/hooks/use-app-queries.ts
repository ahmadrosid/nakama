import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { prefetchTimezoneData } from "@/hooks/use-timezones";
import { telegramSettingsQueryOptions } from "@/hooks/use-telegram-settings";

const defaultStaleTime = 1000 * 30;

export const healthQueryOptions = queryOptions({
  queryKey: queryKeys.health,
  queryFn: () => client.health(),
  staleTime: defaultStaleTime,
});

export const modelsQueryOptions = queryOptions({
  queryKey: queryKeys.models,
  queryFn: () => client.getModels(),
  staleTime: defaultStaleTime,
});

export const profilesQueryOptions = queryOptions({
  queryKey: queryKeys.profiles.all,
  queryFn: async () => (await client.listProfiles()).profiles,
  staleTime: defaultStaleTime,
});

export const toolsQueryOptions = queryOptions({
  queryKey: queryKeys.tools.all,
  queryFn: async () => (await client.listTools()).tools,
  staleTime: defaultStaleTime,
});

export const mcpServersQueryOptions = queryOptions({
  queryKey: queryKeys.mcp.all,
  queryFn: async () => (await client.listMcpServers()).servers,
  staleTime: defaultStaleTime,
});

export const skillsQueryOptions = queryOptions({
  queryKey: queryKeys.skills.all,
  queryFn: async () => (await client.listSkills()).skills,
  staleTime: defaultStaleTime,
});

export function profileQueryOptions(profileId: string) {
  return queryOptions({
    queryKey: queryKeys.profiles.detail(profileId),
    queryFn: async () => (await client.getProfile(profileId)).profile,
    staleTime: defaultStaleTime,
    enabled: Boolean(profileId),
  });
}

export function prefetchAppData(queryClient: QueryClient): void {
  prefetchTimezoneData(queryClient);
  void queryClient.prefetchQuery(telegramSettingsQueryOptions);
  void queryClient.prefetchQuery(healthQueryOptions);
  void queryClient.prefetchQuery(modelsQueryOptions);
  void queryClient.prefetchQuery(profilesQueryOptions);
  void queryClient.prefetchQuery(toolsQueryOptions);
  void queryClient.prefetchQuery(skillsQueryOptions);
}

export function AppQueryPrefetch() {
  const queryClient = useQueryClient();

  useEffect(() => {
    prefetchAppData(queryClient);
  }, [queryClient]);

  return null;
}

export function useHealthQuery() {
  return useQuery(healthQueryOptions);
}

export function useModelsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    ...modelsQueryOptions,
    enabled: options?.enabled ?? true,
  });
}

export function useProfilesQuery() {
  return useQuery(profilesQueryOptions);
}

export function useProfileQuery(profileId: string | null) {
  return useQuery({
    ...profileQueryOptions(profileId ?? ""),
    enabled: Boolean(profileId),
  });
}

export function useToolsQuery() {
  return useQuery(toolsQueryOptions);
}

export function useMcpServersQuery() {
  return useQuery(mcpServersQueryOptions);
}

export function useSkillsQuery() {
  return useQuery(skillsQueryOptions);
}

export function mcpServerDetailQueryOptions(serverId: string) {
  return queryOptions({
    queryKey: queryKeys.mcp.detail(serverId),
    queryFn: async () => (await client.getMcpServer(serverId)).server,
    staleTime: defaultStaleTime,
    enabled: Boolean(serverId),
  });
}

export function useMcpServerDetailQuery(serverId: string | null) {
  return useQuery({
    ...mcpServerDetailQueryOptions(serverId ?? ""),
    enabled: Boolean(serverId),
  });
}

export function toolQueryOptions(toolId: string) {
  return queryOptions({
    queryKey: queryKeys.tools.detail(toolId),
    queryFn: async () => (await client.getTool(toolId)).tool,
    staleTime: defaultStaleTime,
    enabled: Boolean(toolId),
  });
}

export function toolSourceQueryOptions(toolId: string) {
  return queryOptions({
    queryKey: queryKeys.tools.source(toolId),
    queryFn: () => client.getToolSource(toolId),
    staleTime: defaultStaleTime,
    enabled: Boolean(toolId),
  });
}

export function useToolQuery(toolId: string | null) {
  return useQuery({
    ...toolQueryOptions(toolId ?? ""),
    enabled: Boolean(toolId),
  });
}

export function useToolSourceQuery(toolId: string | null) {
  return useQuery({
    ...toolSourceQueryOptions(toolId ?? ""),
    enabled: Boolean(toolId),
  });
}

export const providersQueryOptions = queryOptions({
  queryKey: queryKeys.providers,
  queryFn: () => client.listProviders(),
  staleTime: defaultStaleTime,
});

export function useProvidersQuery(options?: { enabled?: boolean }) {
  return useQuery({
    ...providersQueryOptions,
    enabled: options?.enabled ?? true,
  });
}

async function invalidateProviderQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.health }),
    queryClient.invalidateQueries({ queryKey: queryKeys.models }),
    queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
  ]);
}

export function useCreateProviderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: Parameters<typeof client.createProvider>[0]) =>
      client.createProvider(request),
    onSuccess: async () => {
      await invalidateProviderQueries(queryClient);
    },
  });
}

export function useUpdateProviderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      providerId,
      request,
    }: {
      providerId: string;
      request: Parameters<typeof client.updateProvider>[1];
    }) => client.updateProvider(providerId, request),
    onSuccess: async () => {
      await invalidateProviderQueries(queryClient);
    },
  });
}

export function useDeleteProviderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (providerId: string) => client.deleteProvider(providerId),
    onSuccess: async () => {
      await invalidateProviderQueries(queryClient);
    },
  });
}

export function useConfigureProviderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: Parameters<typeof client.configureProvider>[0]) =>
      client.configureProvider(request),
    onSuccess: async () => {
      await invalidateProviderQueries(queryClient);
    },
  });
}

export function useSetModelMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: Parameters<typeof client.setModel>[0]) => client.setModel(request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.models });
    },
  });
}

export function usePrefetchAppData() {
  const queryClient = useQueryClient();

  return useCallback(() => {
    prefetchAppData(queryClient);
  }, [queryClient]);
}
