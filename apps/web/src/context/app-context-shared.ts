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
  configureProvider: (
    request: ConfigureProviderRequest
  ) => Promise<ConfigureProviderResponse>;
  createProvider: (
    request: CreateProviderRequest
  ) => Promise<CreateProviderResponse>;
  error: string | null;
  health: HealthResponse | null;
  loading: boolean;
  models: ModelsResponse | null;
}

export const AppContext = createContext<AppContextValue | null>(null);
