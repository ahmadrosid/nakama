import {
  apiKeyEnvVarForProvider,
  createProviderInstanceId,
  defaultProviderLabel,
  ensureUserConfigDir,
  isProviderConfigured,
  loadUserConfig,
  type ProviderClient,
  readEnvValue,
  resolveProvider,
  saveUserConfig,
  type UserConfig,
} from "@nakama/core";
import { NETRA_AGENT_MODEL_ID } from "@nakama/core/discovery-providers";
import { createProviderFromActiveConfig } from "./providers";
import {
  type ManagedSecrets,
  providerSecretEnvNames,
} from "./services/managed-secrets";

export interface ProviderBootstrap {
  provider: ProviderClient | null;
  userConfig: UserConfig | null;
}

async function bootstrapProviderFromEnv(
  env: Record<string, string | undefined>
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

  const netraModel =
    providerType === "netra" ? readEnvValue(env, "NETRA_MODEL") : null;
  if (providerType === "netra" && netraModel !== NETRA_AGENT_MODEL_ID) {
    return null;
  }

  const instance = {
    apiKey: "",
    createdAt: new Date().toISOString(),
    id: createProviderInstanceId(),
    label: defaultProviderLabel(providerType, []),
    type: providerType,
    ...(netraModel
      ? { customModels: [{ default: true, id: netraModel }] }
      : {}),
  };

  const config: UserConfig = {
    defaultProviderId: instance.id,
    providers: [instance],
  };

  await saveUserConfig(config);
  return config;
}

export async function ensureProviderConfigured(
  secrets?: ManagedSecrets
): Promise<ProviderBootstrap> {
  await ensureUserConfigDir();
  let userConfig = await loadUserConfig();

  const hydrate = async (
    config: UserConfig | null
  ): Promise<UserConfig | null> =>
    config && secrets
      ? {
          ...config,
          providers: await Promise.all(
            config.providers.map(async (instance) => ({
              ...instance,
              apiKey:
                (
                  await secrets.resolve(
                    "global",
                    `provider:${instance.id}`,
                    providerSecretEnvNames(instance.id, instance.type)
                  )
                ).value ?? "",
            }))
          ),
        }
      : config;

  userConfig = await hydrate(userConfig);

  if (!isProviderConfigured(userConfig, process.env)) {
    userConfig =
      (await hydrate(await bootstrapProviderFromEnv(process.env))) ??
      userConfig;
  }

  const provider = createProviderFromActiveConfig(userConfig, process.env);
  return { provider, userConfig };
}
