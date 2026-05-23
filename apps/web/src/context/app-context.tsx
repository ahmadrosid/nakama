import type { HealthResponse, ModelsResponse } from "@tinyclaw/core/contract";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { client, formatError } from "@/lib/client";

interface AppContextValue {
  health: HealthResponse | null;
  models: ModelsResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextHealth = await client.health();
      setHealth(nextHealth);

      if (nextHealth.providerConfigured) {
        setModels(await client.getModels());
      } else {
        setModels(null);
      }
    } catch (err) {
      setError(formatError(err));
      setHealth(null);
      setModels(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const setModel = useCallback(async (modelId: string) => {
    await client.setModel(modelId);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ health, models, loading, error, refresh, setModel }),
    [health, models, loading, error, refresh, setModel],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const value = useContext(AppContext);

  if (!value) {
    throw new Error("useAppContext must be used within AppProvider");
  }

  return value;
}
