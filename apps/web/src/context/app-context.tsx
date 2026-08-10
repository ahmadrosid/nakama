import type {
  ConfigureProviderRequest,
  CreateProviderRequest,
} from "@nakama/core/contract";
import { type ReactNode, useCallback, useMemo } from "react";
import { AppContext } from "@/context/app-context-shared";
import { useAuth } from "@/context/use-auth";
import {
  useConfigureProviderMutation,
  useCreateProviderMutation,
  useHealthQuery,
  useModelsQuery,
} from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";

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
    async (request: CreateProviderRequest) =>
      createProviderMutation.mutateAsync(request),
    [createProviderMutation]
  );

  const configureProvider = useCallback(
    async (request: ConfigureProviderRequest) =>
      configureProviderMutation.mutateAsync(request),
    [configureProviderMutation]
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
      configureProvider,
      createProvider,
      error,
      health: healthQuery.data ?? null,
      loading,
      models: modelsQuery.data ?? null,
    }),
    [
      healthQuery.data,
      modelsQuery.data,
      loading,
      error,
      createProvider,
      configureProvider,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
