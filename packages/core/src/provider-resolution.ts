import { readEnvValue } from "./config";

import type { ProviderName } from "./contract";

export type UserProviderName = ProviderName;

export const USER_PROVIDER_NAMES: readonly UserProviderName[] = [
  "openai",
  "anthropic",
  "openrouter",
  "gemini",
  "deepseek",
  "cerebras",
  "openai_compatible",
  "opencode_go",
] as const;

export function parseProviderName(value: string | undefined): UserProviderName | null {
  const normalized = value?.trim().toLowerCase();

  if (
    normalized === "openai" ||
    normalized === "anthropic" ||
    normalized === "openrouter" ||
    normalized === "gemini" ||
    normalized === "deepseek" ||
    normalized === "cerebras" ||
    normalized === "openai_compatible" ||
    normalized === "opencode_go"
  ) {
    return normalized;
  }

  return null;
}

export function apiKeyEnvVarForProvider(provider: UserProviderName): string | null {
  switch (provider) {
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "gemini":
      return "GEMINI_API_KEY";
    case "deepseek":
      return null;
    case "cerebras":
      return "CEREBRAS_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "openai_compatible":
      return "OPENAI_COMPATIBLE_API_KEY";
    case "opencode_go":
      return "OPENCODE_GO_API_KEY";
  }
}

export interface ResolveProviderOptions {
  env?: Record<string, string | undefined>;
  configuredProvider?: string | undefined;
}

export function resolveProvider(options: ResolveProviderOptions = {}): UserProviderName | null {
  const env = options.env ?? process.env;

  const explicitEnvProvider = parseProviderName(readEnvValue(env, "NAKAMA_PROVIDER"));

  if (explicitEnvProvider) {
    return explicitEnvProvider;
  }

  const explicitConfiguredProvider = parseProviderName(options.configuredProvider);

  if (explicitConfiguredProvider) {
    return explicitConfiguredProvider;
  }

  const providersWithEnvKeys = USER_PROVIDER_NAMES.filter((provider) => {
    const envVar = apiKeyEnvVarForProvider(provider);
    return envVar && readEnvValue(env, envVar);
  });

  if (providersWithEnvKeys.length === 1) {
    return providersWithEnvKeys[0]!;
  }

  return null;
}
