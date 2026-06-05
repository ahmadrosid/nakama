import { createAnthropicProvider } from "./anthropic";
import { createGeminiProvider } from "./gemini";
import {
  apiKeyEnvVarForProvider,
  readEnvValue,
  type ProviderClient,
  type ProviderName,
} from "@tinyclaw/core";
import { resolveModel } from "./models";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import { createOpenAIProvider } from "./openai";
import { createOpenRouterProvider } from "./openrouter";
import type { UserProviderConfig } from "@tinyclaw/core";

export interface CreateProviderOptions {
  provider: ProviderName;
  apiKey: string;
  model?: string;
  userConfig?: UserProviderConfig | null;
}

function createProvider(options: CreateProviderOptions): ProviderClient {
  const model = resolveModel(
    options.provider,
    options.model,
    options.userConfig?.customModels,
  );

  const baseUrlOverride = options.userConfig?.baseUrl?.trim();

  switch (options.provider) {
    case "openai":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        model,
        ...(baseUrlOverride ? { baseUrl: baseUrlOverride } : {}),
      });
    case "anthropic":
      return createAnthropicProvider({
        apiKey: options.apiKey,
        model,
        ...(baseUrlOverride ? { baseUrl: baseUrlOverride } : {}),
      });
    case "openrouter":
      return createOpenRouterProvider({
        apiKey: options.apiKey,
        model,
      });
    case "gemini":
      return createGeminiProvider({
        apiKey: options.apiKey,
        model,
        ...(baseUrlOverride ? { baseUrl: baseUrlOverride } : {}),
      });
    case "openai_compatible": {
      const displayName = options.userConfig?.displayName?.trim();

      if (!baseUrlOverride || !displayName) {
        throw new Error("OpenAI-compatible provider requires baseUrl and displayName.");
      }

      return createOpenAICompatibleProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride,
        model,
        displayName,
      });
    }
  }
}

function readApiKeyForProvider(
  provider: ProviderName,
  env: Record<string, string | undefined>,
  userConfig?: UserProviderConfig | null,
): string | undefined {
  return readEnvValue(env, apiKeyEnvVarForProvider(provider)) ?? userConfig?.apiKey;
}

function createProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): ProviderClient | null {
  return createProviderFromSources(env);
}

export function createProviderFromSources(
  env: Record<string, string | undefined> = process.env,
  userConfig?: UserProviderConfig | null,
): ProviderClient | null {
  const provider = resolveProvider({ env, configuredProvider: userConfig?.provider });

  if (!provider) {
    return null;
  }

  const apiKey = readApiKeyForProvider(provider, env, userConfig);

  if (!apiKey?.trim()) {
    return null;
  }

  return createProvider({
    provider,
    apiKey,
    model: readEnvValue(env, "TINYCLAW_MODEL") ?? userConfig?.model,
    userConfig,
  });
}
