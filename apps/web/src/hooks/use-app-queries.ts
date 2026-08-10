import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useAuth } from "@/context/use-auth";
import { telegramSettingsQueryOptions } from "@/hooks/use-telegram-settings";
import { thinkingSettingsQueryOptions } from "@/hooks/use-thinking-settings";
import { prefetchTimezoneData } from "@/hooks/use-timezones";
import { whatsappSettingsQueryOptions } from "@/hooks/use-whatsapp-settings";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

const defaultStaleTime = 1000 * 30;

export const healthQueryOptions = queryOptions({
  queryFn: () => client.health(),
  queryKey: queryKeys.health,
  staleTime: defaultStaleTime,
});

export const modelsQueryOptions = queryOptions({
  queryFn: () => client.getModels(),
  queryKey: queryKeys.models,
  staleTime: defaultStaleTime,
});

export const profilesQueryOptions = queryOptions({
  queryFn: async () => (await client.listProfiles()).profiles,
  queryKey: queryKeys.profiles.all,
  staleTime: defaultStaleTime,
});

export const toolsQueryOptions = queryOptions({
  queryFn: async () => (await client.listTools()).tools,
  queryKey: queryKeys.tools.all,
  staleTime: defaultStaleTime,
});

export const mcpServersQueryOptions = queryOptions({
  queryFn: async () => (await client.listMcpServers()).servers,
  queryKey: queryKeys.mcp.all,
  staleTime: defaultStaleTime,
});

export const skillsQueryOptions = queryOptions({
  queryFn: async () => (await client.listSkills()).skills,
  queryKey: queryKeys.skills.all,
  staleTime: defaultStaleTime,
});

export const automationsQueryOptions = queryOptions({
  queryFn: () => client.listAutomations(),
  queryKey: queryKeys.automations.all,
  refetchInterval: 30_000,
  staleTime: defaultStaleTime,
});

export function profileQueryOptions(profileId: string) {
  return queryOptions({
    enabled: Boolean(profileId),
    queryFn: async () => (await client.getProfile(profileId)).profile,
    queryKey: queryKeys.profiles.detail(profileId),
    staleTime: defaultStaleTime,
  });
}

export function prefetchAppData(
  queryClient: QueryClient,
  options?: { isPlatformAdmin?: boolean }
): void {
  prefetchTimezoneData(queryClient);
  void queryClient.prefetchQuery(thinkingSettingsQueryOptions);
  void queryClient.prefetchQuery(telegramSettingsQueryOptions);
  void queryClient.prefetchQuery(whatsappSettingsQueryOptions);
  void queryClient.prefetchQuery(healthQueryOptions);
  void queryClient.prefetchQuery(modelsQueryOptions);
  void queryClient.prefetchQuery(profilesQueryOptions);
  void queryClient.prefetchQuery(automationsQueryOptions);
  if (options?.isPlatformAdmin) {
    void queryClient.prefetchQuery(toolsQueryOptions);
    void queryClient.prefetchQuery(skillsQueryOptions);
  }
}

export function AppQueryPrefetch() {
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading, user } = useAuth();

  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      return;
    }

    prefetchAppData(queryClient, { isPlatformAdmin: user?.isPlatformAdmin });
  }, [queryClient, isAuthenticated, isLoading, user?.isPlatformAdmin]);

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

export function skillQueryOptions(skillId: string) {
  return queryOptions({
    enabled: Boolean(skillId),
    queryFn: async () => (await client.getSkill(skillId)).skill,
    queryKey: queryKeys.skills.detail(skillId),
    staleTime: defaultStaleTime,
  });
}

export function useSkillQuery(skillId: string | null) {
  return useQuery({
    ...skillQueryOptions(skillId ?? ""),
    enabled: Boolean(skillId),
  });
}

export function mcpServerDetailQueryOptions(serverId: string) {
  return queryOptions({
    enabled: Boolean(serverId),
    queryFn: async () => (await client.getMcpServer(serverId)).server,
    queryKey: queryKeys.mcp.detail(serverId),
    staleTime: defaultStaleTime,
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
    enabled: Boolean(toolId),
    queryFn: async () => (await client.getTool(toolId)).tool,
    queryKey: queryKeys.tools.detail(toolId),
    staleTime: defaultStaleTime,
  });
}

export function useToolQuery(toolId: string | null) {
  return useQuery({
    ...toolQueryOptions(toolId ?? ""),
    enabled: Boolean(toolId),
  });
}

export const providersQueryOptions = queryOptions({
  queryFn: () => client.listProviders(),
  queryKey: queryKeys.providers,
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

export function usePrefetchAppData() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useCallback(() => {
    prefetchAppData(queryClient, { isPlatformAdmin: user?.isPlatformAdmin });
  }, [queryClient, user?.isPlatformAdmin]);
}
