import type {
  ConfigureProviderRequest,
  ConfigureProviderResponse,
  CreateProviderRequest,
  CreateProviderResponse,
  HealthResponse,
  ModelsResponse,
} from "@nakama/core/contract";
import { createContext } from "react";

export interface AppContextValue {
  health: HealthResponse | null;
  models: ModelsResponse | null;
  loading: boolean;
  error: string | null;
  createProvider: (request: CreateProviderRequest) => Promise<CreateProviderResponse>;
  configureProvider: (
    request: ConfigureProviderRequest,
  ) => Promise<ConfigureProviderResponse>;
}

export const AppContext = createContext<AppContextValue | null>(null);
