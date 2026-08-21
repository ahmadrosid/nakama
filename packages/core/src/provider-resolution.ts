import { readEnvValue } from "./config";
import type { ProviderName } from "./contract";
import { defaultMinimaxBaseUrl } from "./minimax-provider-config";
import { defaultZhipuBaseUrl } from "./zhipu-provider-config";

export type UserProviderName = ProviderName;

export const USER_PROVIDER_NAMES: readonly UserProviderName[] = [
  "openai",
  "anthropic",
  "openrouter",
  "gemini",
  "deepseek",
  "cerebras",
  "fireworks",
  "ollama",
  "openai_compatible",
  "opencode_go",
  "cloudflare",
  "minimax",
  "minimax_cn",
  "zhipu",
  "zhipu_cn",
] as const;

// Providers whose model lists are discovered live from the platform's
// /models endpoint and stored as instance custom models, instead of a
// hardcoded catalog. Adding a discovery-based provider is one entry here
// plus its type/env-key/label/base-URL wiring — no resolution edits.
export const DISCOVERY_MODEL_PROVIDERS: ReadonlySet<UserProviderName> =
  new Set<UserProviderName>([
    "openai_compatible",
    "minimax",
    "minimax_cn",
    "zhipu",
    "zhipu_cn",
  ]);

export function isDiscoveryModelProvider(provider: UserProviderName): boolean {
  return DISCOVERY_MODEL_PROVIDERS.has(provider);
}

// Region-default base URL for a discovery provider, or null when the family
// has no fixed default (openai_compatible users supply their own endpoint).
export function defaultDiscoveryBaseUrl(
  provider: UserProviderName
): string | null {
  return defaultMinimaxBaseUrl(provider) ?? defaultZhipuBaseUrl(provider);
}

export function parseProviderName(
  value: string | undefined
): UserProviderName | null {
  const normalized = value?.trim().toLowerCase();

  if (
    normalized === "openai" ||
    normalized === "anthropic" ||
    normalized === "openrouter" ||
    normalized === "gemini" ||
    normalized === "deepseek" ||
    normalized === "cerebras" ||
    normalized === "fireworks" ||
    normalized === "ollama" ||
    normalized === "openai_compatible" ||
    normalized === "opencode_go" ||
    normalized === "cloudflare" ||
    normalized === "minimax" ||
    normalized === "minimax_cn" ||
    normalized === "zhipu" ||
    normalized === "zhipu_cn"
  ) {
    return normalized;
  }

  return null;
}

export function apiKeyEnvVarForProvider(
  provider: UserProviderName
): string | null {
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
    case "fireworks":
      return "FIREWORKS_API_KEY";
    case "ollama":
      return "OLLAMA_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "openai_compatible":
      return "OPENAI_COMPATIBLE_API_KEY";
    case "opencode_go":
      return "OPENCODE_GO_API_KEY";
    case "cloudflare":
      return "CLOUDFLARE_API_KEY";
    case "minimax":
      return "MINIMAX_API_KEY";
    case "minimax_cn":
      return "MINIMAX_CN_API_KEY";
    case "zhipu":
      return "ZHIPU_API_KEY";
    case "zhipu_cn":
      return "ZHIPU_CN_API_KEY";
  }
}

export interface ResolveProviderOptions {
  configuredProvider?: string | undefined;
  env?: Record<string, string | undefined>;
}

export function resolveProvider(
  options: ResolveProviderOptions = {}
): UserProviderName | null {
  const env = options.env ?? process.env;

  const explicitEnvProvider = parseProviderName(
    readEnvValue(env, "NAKAMA_PROVIDER")
  );

  if (explicitEnvProvider) {
    return explicitEnvProvider;
  }

  const explicitConfiguredProvider = parseProviderName(
    options.configuredProvider
  );

  if (explicitConfiguredProvider) {
    return explicitConfiguredProvider;
  }

  const providersWithEnvKeys = USER_PROVIDER_NAMES.filter((provider) => {
    const envVar = apiKeyEnvVarForProvider(provider);
    return envVar && readEnvValue(env, envVar);
  });

  const [onlyProvider] = providersWithEnvKeys;
  if (providersWithEnvKeys.length === 1 && onlyProvider) {
    return onlyProvider;
  }

  return null;
}
