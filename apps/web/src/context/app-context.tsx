import type {
  ConfigureProviderRequest,
  ConfigureProviderResponse,
  CreateProviderRequest,
  CreateProviderResponse,
} from "@nakama/core/contract";
import {
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import {
  useConfigureProviderMutation,
  useCreateProviderMutation,
  useHealthQuery,
  useModelsQuery,
} from "@/hooks/use-app-queries";
import { useAuth } from "@/context/use-auth";
import { formatError } from "@/lib/client";
import { AppContext } from "@/context/app-context-shared";

export function AppProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const authReady = isAuthenticated && !authLoading;
  const healthQuery = useHealthQuery();
  const providerConfigured = healthQuery.data?.providerConfigured === true;
  const modelsQuery = useModelsQuery({
    enabled: providerConfigured && authReady,
  });
  const configureProviderMutation = useConfigureProviderMutation();
  const createProviderMutation = useCreateProviderMutation();

  const createProvider = useCallback(
    async (request: CreateProviderRequest) => {
      return createProviderMutation.mutateAsync(request);
    },
    [createProviderMutation],
  );

  const configureProvider = useCallback(
    async (request: ConfigureProviderRequest) => {
      return configureProviderMutation.mutateAsync(request);
    },
    [configureProviderMutation],
  );

  const error = useMemo(() => {
    if (healthQuery.error) {
      return formatError(healthQuery.error);
    }

    if (modelsQuery.error) {
      return formatError(modelsQuery.error);
    }

    return null;
  }, [healthQuery.error, modelsQuery.error]);

  const loading =
    healthQuery.isLoading || (providerConfigured && modelsQuery.isLoading);

  const value = useMemo(
    () => ({
      health: healthQuery.data ?? null,
      models: modelsQuery.data ?? null,
      loading,
      error,
      createProvider,
      configureProvider,
    }),
    [
      healthQuery.data,
      modelsQuery.data,
      loading,
      error,
      createProvider,
      configureProvider,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
