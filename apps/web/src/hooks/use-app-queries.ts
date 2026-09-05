import type {
  SendEmailTestRequest,
  ThinkingEffort,
  UpdateDiscordSettingsRequest,
  UpdateEmailSettingsRequest,
  UpdateErrorTrackingSettingsRequest,
  UpdateTelegramSettingsRequest,
  UpdateThinkingRequest,
  UpdateWebSearchSettingsRequest,
  UpdateWhatsAppSettingsRequest,
  WebPublicUrlSettingsResponse,
} from "@nakama/core/contract";
import {
  type QueryClient,
  type QueryKey,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useAuth } from "@/context/use-auth";
import { prefetchTimezoneData } from "@/hooks/use-timezones";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

const defaultStaleTime = 1000 * 30;

function createSettingsHooks<TData, TRequest>(config: {
  mutationFn: (request: TRequest) => Promise<TData>;
  onSaveError?: (queryClient: QueryClient) => void;
  onSaveSuccess?: (
    queryClient: QueryClient,
    saved: TData
  ) => void | Promise<void>;
  queryFn: () => Promise<TData>;
  queryKey: QueryKey;
}) {
  const settingsQueryOptions = queryOptions({
    queryFn: config.queryFn,
    queryKey: config.queryKey,
  });

  function useSettings() {
    return useQuery(settingsQueryOptions);
  }

  function useSave() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: config.mutationFn,
      onError: config.onSaveError
        ? () => {
            config.onSaveError?.(queryClient);
          }
        : undefined,
      onSuccess: async (saved) => {
        if (config.onSaveSuccess) {
          await config.onSaveSuccess(queryClient, saved);
          return;
        }
        queryClient.setQueryData(config.queryKey, saved);
      },
    });
  }

  function useSetQueryDataMutation<TVariables>(
    mutationFn: (variables: TVariables) => Promise<TData>
  ) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn,
      onSuccess: async (saved) => {
        if (config.onSaveSuccess) {
          await config.onSaveSuccess(queryClient, saved);
          return;
        }
        queryClient.setQueryData(config.queryKey, saved);
      },
    });
  }

  return {
    queryOptions: settingsQueryOptions,
    useSave,
    useSetQueryDataMutation,
    useSettings,
  };
}

const webSearchSettings = createSettingsHooks({
  mutationFn: (request: UpdateWebSearchSettingsRequest) =>
    client.setWebSearchSettings(request),
  queryFn: () => client.getWebSearchSettings(),
  queryKey: queryKeys.webSearchSettings,
});
export const useWebSearchSettings = webSearchSettings.useSettings;
export const useSaveWebSearchSettings = webSearchSettings.useSave;

const visionSettings = createSettingsHooks({
  mutationFn: (model: string | null) => client.setVisionSettings(model),
  queryFn: () => client.getVisionSettings(),
  queryKey: queryKeys.visionSettings,
});
export const useVisionSettings = visionSettings.useSettings;
export const useSaveVisionSettings = visionSettings.useSave;

const imageGenerationSettings = createSettingsHooks({
  mutationFn: (model: string | null) =>
    client.setImageGenerationSettings(model),
  queryFn: () => client.getImageGenerationSettings(),
  queryKey: queryKeys.imageGenerationSettings,
});
export const useImageGenerationSettings = imageGenerationSettings.useSettings;
export const useSaveImageGenerationSettings = imageGenerationSettings.useSave;

const transcriptionSettings = createSettingsHooks({
  mutationFn: (model: string | null) => client.setTranscriptionSettings(model),
  queryFn: () => client.getTranscriptionSettings(),
  queryKey: queryKeys.transcriptionSettings,
});
export const useTranscriptionSettings = transcriptionSettings.useSettings;
export const useSaveTranscriptionSettings = transcriptionSettings.useSave;

const telegramSettings = createSettingsHooks({
  mutationFn: (request: UpdateTelegramSettingsRequest) =>
    client.setTelegramSettings(request),
  queryFn: () => client.getTelegramSettings(),
  queryKey: queryKeys.telegram.settings,
});
export const telegramSettingsQueryOptions = telegramSettings.queryOptions;
export const useTelegramSettings = telegramSettings.useSettings;
export const useSaveTelegramSettings = telegramSettings.useSave;
export function useRegenerateTelegramHandshake() {
  return telegramSettings.useSetQueryDataMutation(() =>
    client.regenerateTelegramHandshake()
  );
}

const discordSettings = createSettingsHooks({
  mutationFn: (request: UpdateDiscordSettingsRequest) =>
    client.setDiscordSettings(request),
  queryFn: () => client.getDiscordSettings(),
  queryKey: queryKeys.discord.settings,
});
export const useDiscordSettings = discordSettings.useSettings;
export const useSaveDiscordSettings = discordSettings.useSave;
export function useRegenerateDiscordHandshake() {
  return discordSettings.useSetQueryDataMutation(() =>
    client.regenerateDiscordHandshake()
  );
}

const emailSettings = createSettingsHooks({
  mutationFn: (request: UpdateEmailSettingsRequest) =>
    client.setEmailSettings(request),
  queryFn: () => client.getEmailSettings(),
  queryKey: queryKeys.email.settings,
});
export const emailSettingsQueryOptions = emailSettings.queryOptions;
export const useSaveEmailSettings = emailSettings.useSave;
export function useSendEmailTest() {
  return useMutation({
    mutationFn: (request: SendEmailTestRequest = {}) =>
      client.sendEmailTest(request),
  });
}

const whatsappSettings = createSettingsHooks({
  mutationFn: (request: UpdateWhatsAppSettingsRequest) =>
    client.setWhatsAppSettings(request),
  onSaveSuccess: async (queryClient, saved) => {
    queryClient.setQueryData(queryKeys.whatsapp.settings, saved);
    await queryClient.invalidateQueries({ queryKey: queryKeys.systemStatus });
  },
  queryFn: () => client.getWhatsAppSettings(),
  queryKey: queryKeys.whatsapp.settings,
});
export const whatsappSettingsQueryOptions = whatsappSettings.queryOptions;
export const useWhatsAppSettings = whatsappSettings.useSettings;
export const useSaveWhatsAppSettings = whatsappSettings.useSave;
export function useRegenerateWhatsAppPairingCode() {
  return whatsappSettings.useSetQueryDataMutation(() =>
    client.regenerateWhatsAppPairingCode()
  );
}
export function useReconnectWhatsApp() {
  return whatsappSettings.useSetQueryDataMutation(() =>
    client.reconnectWhatsApp()
  );
}

const thinkingSettings = createSettingsHooks({
  mutationFn: (settings: UpdateThinkingRequest) =>
    client.setThinkingSettings(settings),
  onSaveError: (queryClient) => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.thinkingSettings,
    });
  },
  queryFn: () => client.getThinkingSettings(),
  queryKey: queryKeys.thinkingSettings,
});
export const thinkingSettingsQueryOptions = thinkingSettings.queryOptions;
export const useThinkingSettings = thinkingSettings.useSettings;
export const useSaveThinkingSettings = thinkingSettings.useSave;
export function buildThinkingSettingsPayload(
  effort: ThinkingEffort
): UpdateThinkingRequest {
  return {
    effort,
    enabled: true,
  };
}

const webPublicUrlSettings = createSettingsHooks<
  WebPublicUrlSettingsResponse,
  string
>({
  mutationFn: async (webPublicUrl: string) => {
    const saved = await client.updateWebPublicUrl(webPublicUrl);
    return { envOverride: null, webPublicUrl: saved.webPublicUrl };
  },
  onSaveSuccess: (queryClient) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.webPublicUrl });
  },
  queryFn: () => client.getWebPublicUrl(),
  queryKey: queryKeys.webPublicUrl,
});
export const useWebPublicUrlSettings = webPublicUrlSettings.useSettings;
export const useSaveWebPublicUrl = webPublicUrlSettings.useSave;

const errorTrackingSettings = createSettingsHooks({
  mutationFn: (request: UpdateErrorTrackingSettingsRequest) =>
    client.setErrorTrackingSettings(request),
  queryFn: () => client.getErrorTrackingSettings(),
  queryKey: queryKeys.errorTracking.settings,
});
export const useErrorTrackingSettings = errorTrackingSettings.useSettings;
export const useSaveErrorTrackingSettings = errorTrackingSettings.useSave;
export function useSendErrorTrackingTest() {
  return useMutation({ mutationFn: () => client.sendErrorTrackingTest() });
}

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
