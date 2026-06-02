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

export function useConfigureProviderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      apiKey,
      model,
      provider,
    }: {
      apiKey: string;
      model?: string;
      provider?: "openai" | "anthropic" | "openrouter" | "gemini";
    }) => client.configureProvider({ apiKey, model, provider }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.health }),
        queryClient.invalidateQueries({ queryKey: queryKeys.models }),
      ]);
    },
  });
}

export function useSetModelMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (model: string) => client.setModel(model),
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
