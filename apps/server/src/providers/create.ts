import {
  apiKeyEnvVarForProvider,
  getActiveProviderInstance,
  isOllamaCloudInstance,
  type ProviderClient,
  type ProviderInstance,
  type ProviderName,
  readEnvValue,
  type UserConfig,
} from "@nakama/core";
import {
  MINIMAX_CN_DEFAULT_BASE_URL,
  MINIMAX_DEFAULT_BASE_URL,
} from "@nakama/core/minimax-provider-config";
import {
  ZHIPU_CN_DEFAULT_BASE_URL,
  ZHIPU_DEFAULT_BASE_URL,
} from "@nakama/core/zhipu-provider-config";
import { resolveDefaultModelForInstance } from "../services/provider-instance-helpers";
import { createAnthropicProvider } from "./anthropic";
import { createCerebrasProvider } from "./cerebras";
import { createCloudflareProvider } from "./cloudflare";
import { compatibleModelSupportsThinking } from "./compatible-models";
import { createFireworksProvider } from "./fireworks";
import { createGeminiProvider } from "./gemini";
import { resolveModel } from "./models";
import { createOllamaProvider } from "./ollama";
import { createOpenAIProvider } from "./openai";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import { createOpenCodeGoProvider } from "./opencode-go";
import { createOpenRouterProvider } from "./openrouter";

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export interface CreateProviderOptions {
  apiKey: string;
  instance?: ProviderInstance | null;
  model?: string;
  provider: ProviderName;
}

function createProvider(options: CreateProviderOptions): ProviderClient {
  const model = resolveModel(
    options.provider,
    options.model,
    options.instance?.customModels
  );

  const baseUrlOverride = options.instance?.baseUrl?.trim();

  switch (options.provider) {
    case "openai":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        model,
        ...(baseUrlOverride ? { baseUrl: baseUrlOverride } : {}),
        customModels: options.instance?.customModels,
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
        customModels: options.instance?.customModels,
        model,
      });
    case "gemini":
      return createGeminiProvider({
        apiKey: options.apiKey,
        model,
        ...(baseUrlOverride ? { baseUrl: baseUrlOverride } : {}),
      });
    case "deepseek":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? DEFAULT_DEEPSEEK_BASE_URL,
        model,
        providerName: "deepseek",
      });
    case "minimax":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? MINIMAX_DEFAULT_BASE_URL,
        model,
        providerName: "minimax",
      });
    case "minimax_cn":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? MINIMAX_CN_DEFAULT_BASE_URL,
        model,
        providerName: "minimax_cn",
      });
    case "zhipu":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? ZHIPU_DEFAULT_BASE_URL,
        model,
        providerName: "zhipu",
      });
    case "zhipu_cn":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? ZHIPU_CN_DEFAULT_BASE_URL,
        model,
        providerName: "zhipu_cn",
      });
    case "opencode_go":
      return createOpenCodeGoProvider({
        apiKey: options.apiKey,
        model,
      });
    case "cerebras":
      return createCerebrasProvider({
        apiKey: options.apiKey,
        customModels: options.instance?.customModels,
        model,
      });
    case "fireworks":
      return createFireworksProvider({
        apiKey: options.apiKey,
        customModels: options.instance?.customModels,
        model,
      });
    case "cloudflare":
      return createCloudflareProvider({
        accountId: readEnvValue(process.env, "CLOUDFLARE_ACCOUNT_ID") ?? "",
        apiKey: options.apiKey,
        instance: options.instance,
        model,
      });
    case "ollama":
      return createOllamaProvider({
        apiKey: options.apiKey,
        instance: options.instance,
        model,
      });
    case "openai_compatible": {
      const displayName = options.instance?.label?.trim();

      if (!(baseUrlOverride && displayName)) {
        throw new Error(
          "OpenAI-compatible provider requires baseUrl and label."
        );
      }

      return createOpenAICompatibleProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride,
        displayName,
        model,
        supportsThinking: compatibleModelSupportsThinking(
          model,
          options.instance?.customModels
        ),
      });
    }
  }
}

export function readApiKeyForInstance(
  instance: ProviderInstance,
  env: Record<string, string | undefined>
): string | undefined {
  if (instance.apiKey.trim()) {
    return instance.apiKey;
  }

  const envVar = apiKeyEnvVarForProvider(instance.type);
  if (!envVar) {
    return;
  }

  return readEnvValue(env, envVar);
}

export function createProviderForInstance(
  instance: ProviderInstance,
  model: string,
  env: Record<string, string | undefined> = process.env
): ProviderClient | null {
  const apiKey = readApiKeyForInstance(instance, env);

  if (
    !apiKey?.trim() &&
    instance.type !== "openai_compatible" &&
    instance.type !== "ollama"
  ) {
    return null;
  }

  if (
    instance.type === "ollama" &&
    isOllamaCloudInstance(instance) &&
    !apiKey?.trim()
  ) {
    return null;
  }

  return createProvider({
    apiKey: apiKey ?? "",
    instance,
    model,
    provider: instance.type,
  });
}

export function createProviderFromActiveConfig(
  userConfig: UserConfig | null | undefined,
  env: Record<string, string | undefined> = process.env
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
  userConfig?: UserConfig | null
): ProviderClient | null {
  return createProviderFromActiveConfig(userConfig, env);
}
