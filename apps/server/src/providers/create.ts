import { resolveDefaultModelForInstance } from "../services/provider-instance-helpers";
import { createAnthropicProvider } from "./anthropic";
import { createGeminiProvider } from "./gemini";
import {
  apiKeyEnvVarForProvider,
  getActiveProviderInstance,
  readEnvValue,
  type ProviderClient,
  type ProviderInstance,
  type ProviderName,
  type UserConfig,
} from "@tinyclaw/core";
import { resolveModel } from "./models";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import { createOpenAIProvider } from "./openai";
import { createOpenCodeGoProvider } from "./opencode-go";
import { createOpenRouterProvider } from "./openrouter";

export interface CreateProviderOptions {
  provider: ProviderName;
  apiKey: string;
  model?: string;
  instance?: ProviderInstance | null;
}

function createProvider(options: CreateProviderOptions): ProviderClient {
  const model = resolveModel(
    options.provider,
    options.model,
    options.instance?.customModels,
  );

  const baseUrlOverride = options.instance?.baseUrl?.trim();

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
    case "opencode_go":
      return createOpenCodeGoProvider({
        apiKey: options.apiKey,
        model,
      });
    case "openai_compatible": {
      const displayName = options.instance?.label?.trim();

      if (!baseUrlOverride || !displayName) {
        throw new Error("OpenAI-compatible provider requires baseUrl and label.");
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

function readApiKeyForInstance(
  instance: ProviderInstance,
  env: Record<string, string | undefined>,
): string | undefined {
  if (instance.apiKey.trim()) {
    return instance.apiKey;
  }

  return readEnvValue(env, apiKeyEnvVarForProvider(instance.type));
}

export function createProviderForInstance(
  instance: ProviderInstance,
  model: string,
  env: Record<string, string | undefined> = process.env,
): ProviderClient | null {
  const apiKey = readApiKeyForInstance(instance, env);

  if (!apiKey?.trim() && instance.type !== "openai_compatible") {
    return null;
  }

  return createProvider({
    provider: instance.type,
    apiKey: apiKey ?? "",
    model,
    instance,
  });
}

export function createProviderFromActiveConfig(
  userConfig: UserConfig | null | undefined,
  env: Record<string, string | undefined> = process.env,
): ProviderClient | null {
  const instance = getActiveProviderInstance(userConfig);

  if (!instance) {
    return null;
  }

  const model = resolveDefaultModelForInstance(instance);

  if (!model) {
    return null;
  }

  return createProviderForInstance(instance, model, env);
}

export function createProviderFromSources(
  env: Record<string, string | undefined> = process.env,
  userConfig?: UserConfig | null,
): ProviderClient | null {
  return createProviderFromActiveConfig(userConfig, env);
}
