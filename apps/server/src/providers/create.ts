import { createAnthropicProvider } from "./anthropic";
import { detectProvider } from "./detect";
import type { ProviderClient, ProviderName } from "@tinyclaw/core";
import { resolveModel } from "./models";
import { createOpenAIProvider } from "./openai";
import type { UserProviderConfig } from "@tinyclaw/core";

export interface CreateProviderOptions {
  provider: ProviderName;
  apiKey: string;
  model?: string;
}

export function createProvider(options: CreateProviderOptions): ProviderClient {
  const model = resolveModel(options.provider, options.model);

  switch (options.provider) {
    case "openai":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        model,
      });
    case "anthropic":
      return createAnthropicProvider({
        apiKey: options.apiKey,
        model,
      });
  }
}

export function createProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): ProviderClient | null {
  return createProviderFromSources(env);
}

export function createProviderFromSources(
  env: Record<string, string | undefined> = process.env,
  userConfig?: UserProviderConfig | null,
): ProviderClient | null {
  const provider = detectProvider(env, userConfig);

  if (!provider) {
    return null;
  }

  const apiKey =
    provider === "openai"
      ? env.OPENAI_API_KEY ?? userConfig?.apiKey
      : env.ANTHROPIC_API_KEY ?? userConfig?.apiKey;

  if (!apiKey?.trim()) {
    return null;
  }

  return createProvider({
    provider,
    apiKey,
    model: env.TINYCLAW_MODEL ?? userConfig?.model,
  });
}
