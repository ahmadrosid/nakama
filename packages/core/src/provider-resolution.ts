import { readEnvValue } from "./config";
import type { ProviderName } from "./contract";

export type UserProviderName = ProviderName;

export const USER_PROVIDER_NAMES: readonly UserProviderName[] = [
  "openai",
  "anthropic",
  "openrouter",
  "gemini",
  "deepseek",
  "doubao",
  "mistral",
  "perplexity",
  "cerebras",
  "fireworks",
  "ollama",
  "openai_compatible",
  "opencode_go",
  "cloudflare",
  "chatgpt",
  "xai_oauth",
  "minimax",
  "minimax_cn",
  "moonshot",
  "moonshot_cn",
  "zhipu",
  "zhipu_cn",
  "xai",
  "together",
  "qwen",
  "qwen_cn",
  "vercel_ai_gateway",
] as const;

export {
  DISCOVERY_MODEL_PROVIDERS,
  defaultDiscoveryBaseUrl,
  isDiscoveryModelProvider,
} from "./discovery-providers";

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
    normalized === "doubao" ||
    normalized === "mistral" ||
    normalized === "perplexity" ||
    normalized === "cerebras" ||
    normalized === "fireworks" ||
    normalized === "ollama" ||
    normalized === "openai_compatible" ||
    normalized === "opencode_go" ||
    normalized === "cloudflare" ||
    normalized === "chatgpt" ||
    normalized === "xai_oauth" ||
    normalized === "minimax" ||
    normalized === "minimax_cn" ||
    normalized === "moonshot" ||
    normalized === "moonshot_cn" ||
    normalized === "zhipu" ||
    normalized === "zhipu_cn" ||
    normalized === "xai" ||
    normalized === "together" ||
    normalized === "qwen" ||
    normalized === "qwen_cn" ||
    normalized === "vercel_ai_gateway"
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
    case "doubao":
      return "DOUBAO_API_KEY";
    case "mistral":
      return "MISTRAL_API_KEY";
    case "perplexity":
      return "PERPLEXITY_API_KEY";
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
    case "xai_oauth":
    case "chatgpt":
      return null;
    case "minimax":
      return "MINIMAX_API_KEY";
    case "minimax_cn":
      return "MINIMAX_CN_API_KEY";
    case "moonshot":
      return "MOONSHOT_API_KEY";
    case "moonshot_cn":
      return "MOONSHOT_CN_API_KEY";
    case "zhipu":
      return "ZHIPU_API_KEY";
    case "zhipu_cn":
      return "ZHIPU_CN_API_KEY";
    case "xai":
      return "XAI_API_KEY";
    case "together":
      return "TOGETHER_API_KEY";
    case "qwen":
      return "QWEN_API_KEY";
    case "qwen_cn":
      return "QWEN_CN_API_KEY";
    case "vercel_ai_gateway":
      return "VERCEL_AI_GATEWAY_API_KEY";
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
