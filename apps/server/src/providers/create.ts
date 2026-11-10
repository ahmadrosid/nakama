import {
  apiKeyEnvVarForProvider,
  findCustomModel,
  getActiveProviderInstance,
  isChatgptProviderConnected,
  isOllamaCloudInstance,
  normalizeBaseUrl,
  type ProviderClient,
  type ProviderInstance,
  type ProviderName,
  readChatgptOAuthFromInstance,
  readEnvValue,
  readXaiOAuthFromInstance,
  type UserConfig,
} from "@nakama/core";
import type {
  ChatgptOAuthCredentials,
  XaiOAuthCredentials,
} from "@nakama/core/contract";
import {
  defaultDiscoveryBaseUrl,
  NETRA_AGENT_MODEL_ID,
} from "@nakama/core/discovery-providers";
import { resolveDefaultModelForInstance } from "../services/provider-instance-helpers";
import { createAnthropicProvider } from "./anthropic";
import { CEREBRAS_CHAT_BASE_URL } from "./cerebras";
import { createChatgptProvider } from "./chatgpt";
import { createCloudflareProvider } from "./cloudflare";
import { createCommandCodeProvider } from "./command-code";
import {
  compatibleModelSupportsThinking,
  fetchNetraModelLimits,
} from "./compatible-models";
import { FIREWORKS_INFERENCE_BASE_URL } from "./fireworks";
import { createGeminiProvider } from "./gemini";
import { resolveModel } from "./models";
import { createOllamaProvider } from "./ollama";
import { createOpenAIProvider } from "./openai";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import { createOpenCodeGoProvider } from "./opencode-go";
import { createOpenRouterProvider } from "./openrouter";
import { createXaiProvider } from "./xai-oauth";

// Used when Netra's /v1/models cannot be read or reports no output limit, as
// opencode does for models without a known limit.
export const NETRA_MAX_OUTPUT_TOKENS = 32_000;

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

const DEFAULT_DOUBAO_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

const DEFAULT_TOGETHER_BASE_URL = "https://api.together.xyz/v1";

const DEFAULT_XIAOMI_BASE_URL = "https://api.xiaomimimo.com/v1";

const DEFAULT_META_BASE_URL = "https://api.meta.ai/v1";

const DEFAULT_VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

const DEFAULT_MISTRAL_BASE_URL = "https://api.mistral.ai/v1";

const DEFAULT_QWEN_BASE_URL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

const DEFAULT_QWEN_CN_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";

const DEFAULT_PERPLEXITY_BASE_URL = "https://api.perplexity.ai";

const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";

interface CreateProviderOptions {
  apiKey: string;
  instance?: ProviderInstance | null;
  model?: string;
  provider: Exclude<ProviderName, "chatgpt" | "xai_oauth">;
  sessionId?: string;
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
    case "openai": {
      const providerOptions: Parameters<typeof createOpenAIProvider>[0] = {
        apiKey: options.apiKey,
        customModels: options.instance?.customModels,
        model,
      };

      if (baseUrlOverride) {
        providerOptions.baseUrl = baseUrlOverride;
      }

      return createOpenAIProvider(providerOptions);
    }

    case "anthropic": {
      const providerOptions: Parameters<typeof createAnthropicProvider>[0] = {
        apiKey: options.apiKey,
        model,
      };

      if (baseUrlOverride) {
        providerOptions.baseUrl = baseUrlOverride;
      }

      return createAnthropicProvider(providerOptions);
    }

    case "openrouter":
      return createOpenRouterProvider({
        apiKey: options.apiKey,
        customModels: options.instance?.customModels,
        model,
        openRouterRouting: options.instance?.openRouterRouting,
      });
    case "gemini": {
      const providerOptions: Parameters<typeof createGeminiProvider>[0] = {
        apiKey: options.apiKey,
        model,
      };

      if (baseUrlOverride) {
        providerOptions.baseUrl = baseUrlOverride;
      }

      return createGeminiProvider(providerOptions);
    }

    case "deepseek":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? DEFAULT_DEEPSEEK_BASE_URL,
        model,
        providerName: "deepseek",
      });
    case "netra":
      // Start the one lookup now, so it is usually done by the first request.
      if (
        !findCustomModel(options.instance?.customModels, model)?.maxOutputTokens
      ) {
        fetchNetraModelLimits(options.apiKey, model);
      }

      return createOpenAICompatibleProvider({
        apiKey: options.apiKey,
        baseUrl: discoveryBaseUrl!,
        displayName: "Netra Runtime",
        model,
        providerName: "netra",
        // A limit saved on the model wins, then the one Netra reports.
        resolveMaxOutputTokens: async () =>
          findCustomModel(options.instance?.customModels, model)
            ?.maxOutputTokens ??
          (await fetchNetraModelLimits(options.apiKey, model))
            .maxOutputTokens ??
          NETRA_MAX_OUTPUT_TOKENS,
        // V4.1 Flash always thinks; a model added by hand uses its saved flag.
        supportsThinking:
          model === NETRA_AGENT_MODEL_ID ||
          compatibleModelSupportsThinking(
            model,
            options.instance?.customModels
          ),
      });
    case "doubao":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? DEFAULT_DOUBAO_BASE_URL,
        model,
        providerName: "doubao",
      });
    case "together":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? DEFAULT_TOGETHER_BASE_URL,
        model,
        providerName: "together",
      });
    case "xiaomi":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? DEFAULT_XIAOMI_BASE_URL,
        model,
        providerName: "xiaomi",
      });
    case "meta":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? DEFAULT_META_BASE_URL,
        model,
        providerName: "meta",
      });
    case "vercel_ai_gateway":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? DEFAULT_VERCEL_AI_GATEWAY_BASE_URL,
        model,
        providerName: "vercel_ai_gateway",
      });
    case "mistral":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? DEFAULT_MISTRAL_BASE_URL,
        model,
        providerName: "mistral",
      });
    case "qwen":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? DEFAULT_QWEN_BASE_URL,
        model,
        providerName: "qwen",
      });
    case "qwen_cn":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? DEFAULT_QWEN_CN_BASE_URL,
        model,
        providerName: "qwen_cn",
      });
    case "perplexity":
      return createOpenAIProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride ?? DEFAULT_PERPLEXITY_BASE_URL,
        model,
        providerName: "perplexity",
      });
    case "minimax":
    case "minimax_cn":
    case "moonshot":
    case "moonshot_cn":
    case "zhipu":
    case "zhipu_cn":
    case "groq":
    case "cheaper_inference":
    case "standardcompute":
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
        baseUrl: baseUrlOverride,
        model,
        sessionId: options.sessionId,
      });
    case "command_code":
      return createCommandCodeProvider({
        apiKey: options.apiKey,
        baseUrl: baseUrlOverride,
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

// A cheap authenticated read that answers 401/403 for a bad key. Null when the
// provider has no such endpoint we know, or checks its key another way.
export function apiKeyCheckRequest(
  instance: ProviderInstance
): { url: string; headers: Record<string, string> } | null {
  const apiKey = instance.apiKey.trim();

  const baseUrlOverride =
    instance.baseUrl && normalizeBaseUrl(instance.baseUrl);

  if (!apiKey) {
    return null;
  }

  const bearer = { Authorization: `Bearer ${apiKey}` };

  if (instance.type === "anthropic") {
    return baseUrlOverride
      ? null
      : {
          headers: { "anthropic-version": "2023-06-01", "x-api-key": apiKey },
          url: "https://api.anthropic.com/v1/models",
        };
  }

  if (instance.type === "openrouter") {
    return { headers: bearer, url: "https://openrouter.ai/api/v1/key" };
  }

  const defaultBaseUrls: Partial<Record<ProviderInstance["type"], string>> = {
    deepseek: DEFAULT_DEEPSEEK_BASE_URL,
    mistral: DEFAULT_MISTRAL_BASE_URL,
    openai: "https://api.openai.com/v1",
    together: DEFAULT_TOGETHER_BASE_URL,
    xai: DEFAULT_XAI_BASE_URL,
  };

  const defaultBaseUrl =
    defaultBaseUrls[instance.type] ??
    (instance.type === "netra" ? null : defaultDiscoveryBaseUrl(instance.type));

  if (!(defaultBaseUrl || instance.type === "openai_compatible")) {
    return null;
  }

  const baseUrl = baseUrlOverride || defaultBaseUrl;

  return baseUrl ? { headers: bearer, url: `${baseUrl}/models` } : null;
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
  onXaiTokenRefresh?: (
    instanceId: string,
    oauth: XaiOAuthCredentials
  ) => Promise<void>;
  resolveInstance?: (instanceId: string) => ProviderInstance | null;
  sessionId?: string;
}

export function createProviderForInstance(
  instance: ProviderInstance,
  model: string,
  env: Record<string, string | undefined> = process.env,
  options?: CreateProviderForInstanceOptions
): ProviderClient | null {
  if (instance.type === "xai_oauth") {
    if (!readXaiOAuthFromInstance(instance)) {
      return null;
    }

    const providerOptions: Parameters<typeof createXaiProvider>[0] = {
      getOAuth: () => {
        const latest = options?.resolveInstance
          ? options.resolveInstance(instance.id)
          : instance;

        return readXaiOAuthFromInstance(latest);
      },
      model,
    };

    if (options?.onXaiTokenRefresh) {
      providerOptions.onTokenRefresh = (oauth) =>
        options.onXaiTokenRefresh!(instance.id, oauth);
    }

    return createXaiProvider(providerOptions);
  }

  if (instance.type === "chatgpt") {
    if (!isChatgptProviderConnected(instance)) {
      return null;
    }

    const providerOptions: Parameters<typeof createChatgptProvider>[0] = {
      getOAuth: () => {
        const latest = options?.resolveInstance?.(instance.id) ?? instance;

        return readChatgptOAuthFromInstance(latest);
      },
      model,
    };

    if (options?.onChatgptTokenRefresh) {
      providerOptions.onTokenRefresh = (oauth) =>
        options.onChatgptTokenRefresh!(instance.id, oauth);
    }

    return createChatgptProvider(providerOptions);
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
    sessionId: options?.sessionId,
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
