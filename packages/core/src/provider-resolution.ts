import { readEnvValue } from "./config";

import type { ProviderName } from "./contract";

export type UserProviderName = ProviderName;

export const USER_PROVIDER_NAMES: readonly UserProviderName[] = [
  "openai",
  "anthropic",
  "openrouter",
  "gemini",
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
    normalized === "openai_compatible" ||
    normalized === "opencode_go"
  ) {
    return normalized;
  }

  return null;
}

export function apiKeyEnvVarForProvider(provider: UserProviderName): string {
  switch (provider) {
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "gemini":
      return "GEMINI_API_KEY";
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

  const explicitEnvProvider = parseProviderName(readEnvValue(env, "TINYCLAW_PROVIDER"));

  if (explicitEnvProvider) {
    return explicitEnvProvider;
  }

  const explicitConfiguredProvider = parseProviderName(options.configuredProvider);

  if (explicitConfiguredProvider) {
    return explicitConfiguredProvider;
  }

  const providersWithEnvKeys = USER_PROVIDER_NAMES.filter((provider) =>
    readEnvValue(env, apiKeyEnvVarForProvider(provider)),
  );

  if (providersWithEnvKeys.length === 1) {
    return providersWithEnvKeys[0]!;
  }

  return null;
}
