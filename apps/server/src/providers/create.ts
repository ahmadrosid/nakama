import {
  apiKeyEnvVarForProvider,
  getActiveProviderInstance,
  isChatgptProviderConnected,
  isOllamaCloudInstance,
  type ProviderClient,
  type ProviderInstance,
  type ProviderName,
  readChatgptOAuthFromInstance,
  readEnvValue,
  type UserConfig,
} from "@nakama/core";
import type { ChatgptOAuthCredentials } from "@nakama/core/contract";
import { defaultDiscoveryBaseUrl } from "@nakama/core/discovery-providers";
import { resolveDefaultModelForInstance } from "../services/provider-instance-helpers";
import { createAnthropicProvider } from "./anthropic";
import { CEREBRAS_CHAT_BASE_URL } from "./cerebras";
import { createChatgptProvider } from "./chatgpt";
import { createCloudflareProvider } from "./cloudflare";
import { compatibleModelSupportsThinking } from "./compatible-models";
import { FIREWORKS_INFERENCE_BASE_URL } from "./fireworks";
import { createGeminiProvider } from "./gemini";
import { resolveModel } from "./models";
import { createOllamaProvider } from "./ollama";
import { createOpenAIProvider } from "./openai";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import { createOpenCodeGoProvider } from "./opencode-go";
import { createOpenRouterProvider } from "./openrouter";

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MISTRAL_BASE_URL = "https://api.mistral.ai/v1";
const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";

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
  const discoveryBaseUrl =
    defaultDiscoveryBaseUrl(options.provider) ?? undefined;

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
    case "mistral":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? DEFAULT_MISTRAL_BASE_URL,
        model,
        providerName: "mistral",
      });
    case "minimax":
    case "minimax_cn":
    case "zhipu":
    case "zhipu_cn":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? discoveryBaseUrl,
        model,
        providerName: options.provider,
      });
    case "xai":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? DEFAULT_XAI_BASE_URL,
        model,
        providerName: "xai",
      });
    case "opencode_go":
      return createOpenCodeGoProvider({
        apiKey: options.apiKey,
        model,
      });
    case "cerebras":
      return createOpenAICompatibleProvider({
        apiKey: options.apiKey,
        baseUrl: CEREBRAS_CHAT_BASE_URL,
        displayName: "Cerebras",
        model,
        providerName: "cerebras",
        supportsThinking: compatibleModelSupportsThinking(
          model,
          options.instance?.customModels
        ),
      });
    case "fireworks":
      return createOpenAICompatibleProvider({
        apiKey: options.apiKey,
        baseUrl: FIREWORKS_INFERENCE_BASE_URL,
        displayName: "Fireworks",
        model,
        providerName: "fireworks",
        supportsThinking: compatibleModelSupportsThinking(
          model,
          options.instance?.customModels
        ),
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
        wireApi: options.instance?.wireApi,
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

export interface CreateProviderForInstanceOptions {
  onChatgptTokenRefresh?: (
    instanceId: string,
    oauth: ChatgptOAuthCredentials
  ) => Promise<void>;
  resolveInstance?: (instanceId: string) => ProviderInstance | null;
}

export function createProviderForInstance(
  instance: ProviderInstance,
  model: string,
  env: Record<string, string | undefined> = process.env,
  options?: CreateProviderForInstanceOptions
): ProviderClient | null {
  if (instance.type === "chatgpt") {
    if (!isChatgptProviderConnected(instance)) {
      return null;
    }

    return createChatgptProvider({
      getOAuth: () => {
        const latest = options?.resolveInstance?.(instance.id) ?? instance;
        return readChatgptOAuthFromInstance(latest);
      },
      model,
      ...(options?.onChatgptTokenRefresh
        ? {
            onTokenRefresh: (oauth) =>
              options.onChatgptTokenRefresh!(instance.id, oauth),
          }
        : {}),
    });
  }

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
