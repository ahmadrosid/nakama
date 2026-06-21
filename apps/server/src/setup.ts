import {
  ensureUserConfigDir,
  loadUserConfig,
  type ProviderClient,
  type UserConfig,
} from "@tinyclaw/core";
import { createProviderFromSources } from "./providers";

export interface ProviderBootstrap {
  provider: ProviderClient | null;
  userConfig: UserConfig | null;
}

export async function ensureProviderConfigured(): Promise<ProviderBootstrap> {
  await ensureUserConfigDir();
  const userConfig = await loadUserConfig();
  const provider = createProviderFromSources(process.env, userConfig);
  return { provider, userConfig };
}
