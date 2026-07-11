import {
  apiKeyEnvVarForProvider,
  createProviderInstanceId,
  defaultProviderLabel,
  ensureUserConfigDir,
  isProviderConfigured,
  loadUserConfig,
  readEnvValue,
  resolveProvider,
  saveUserConfig,
  type ProviderClient,
  type UserConfig,
} from "@nakama/core";
import { createProviderFromSources } from "./providers";

export interface ProviderBootstrap {
  provider: ProviderClient | null;
  userConfig: UserConfig | null;
}

async function bootstrapProviderFromEnv(
  env: Record<string, string | undefined>,
): Promise<UserConfig | null> {
  const providerType = resolveProvider({ env });

  if (!providerType || providerType === "openai_compatible") {
    return null;
  }

  const envVar = apiKeyEnvVarForProvider(providerType);
  const apiKey = envVar ? readEnvValue(env, envVar) : undefined;

  if (!apiKey) {
    return null;
  }

  const instance = {
    id: createProviderInstanceId(),
    type: providerType,
    label: defaultProviderLabel(providerType, []),
    apiKey: "",
    createdAt: new Date().toISOString(),
  };

  const config: UserConfig = {
    defaultProviderId: instance.id,
    providers: [instance],
  };

  await saveUserConfig(config);
  return config;
}

export async function ensureProviderConfigured(): Promise<ProviderBootstrap> {
  await ensureUserConfigDir();
  let userConfig = await loadUserConfig();

  if (!isProviderConfigured(userConfig, process.env)) {
    userConfig = (await bootstrapProviderFromEnv(process.env)) ?? userConfig;
  }

  const provider = createProviderFromSources(process.env, userConfig);
  return { provider, userConfig };
}
