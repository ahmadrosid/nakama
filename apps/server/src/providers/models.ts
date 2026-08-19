import type { ProviderName } from "@nakama/core";
import {
  type CustomModelEntry,
  findCustomModel,
  validateCustomModels,
} from "@nakama/core";
import type { ProviderModelOption as ContractProviderModelOption } from "@nakama/core/contract";
import {
  resolveCerebrasDefaultModel,
  resolveCompatibleDefaultModel,
  resolveFireworksDefaultModel,
  resolveOllamaDefaultModel,
  resolveOpenRouterDefaultModel,
} from "./compatible-models";

export type ProviderModelOption = ContractProviderModelOption & {
  contextWindow: number;
  maxOutputTokens: number;
};

function withVisionDefaults(
  models: ProviderModelOption[]
): ProviderModelOption[] {
  return models.map((model) => ({
    ...model,
    supportsVision:
      model.provider === "opencode_go" || model.provider === "deepseek"
        ? false
        : model.provider === "openai" ||
            model.provider === "anthropic" ||
            model.provider === "gemini"
          ? true
          : model.supportsVision,
  }));
}

export const AVAILABLE_MODELS: ProviderModelOption[] = withVisionDefaults([
  {
    contextWindow: 200_000,
    default: true,
    id: "claude-sonnet-4-6",
    inputPerMillionUsd: 3,
    maxOutputTokens: 8192,
    name: "Sonnet 4.6",
    outputPerMillionUsd: 15,
    provider: "anthropic",
  },
  {
    contextWindow: 200_000,
    id: "claude-opus-4-6",
    inputPerMillionUsd: 15,
    maxOutputTokens: 8192,
    name: "Opus 4.6",
    outputPerMillionUsd: 75,
    provider: "anthropic",
  },
  {
    contextWindow: 128_000,
    id: "gpt-5.5",
    inputPerMillionUsd: 2.5,
    maxOutputTokens: 8192,
    name: "GPT-5.5",
    outputPerMillionUsd: 10,
    provider: "openai",
  },
  {
    contextWindow: 128_000,
    default: true,
    id: "gpt-5.4",
    inputPerMillionUsd: 2,
    maxOutputTokens: 8192,
    name: "GPT-5.4",
    outputPerMillionUsd: 8,
    provider: "openai",
  },
  {
    contextWindow: 128_000,
    id: "gpt-5.3-codex",
    inputPerMillionUsd: 1.5,
    maxOutputTokens: 8192,
    name: "GPT-5.3 Codex",
    outputPerMillionUsd: 6,
    provider: "openai",
  },
  {
    contextWindow: 128_000,
    id: "gpt-4o-mini",
    inputPerMillionUsd: 0.15,
    maxOutputTokens: 16_384,
    name: "GPT-4o mini",
    outputPerMillionUsd: 0.6,
    provider: "openai",
    supportsThinking: false,
  },
  {
    contextWindow: 1_000_000,
    default: true,
    id: "gemini-2.5-flash",
    inputPerMillionUsd: 0.15,
    maxOutputTokens: 8192,
    name: "Gemini 2.5 Flash",
    outputPerMillionUsd: 0.6,
    provider: "gemini",
  },
  {
    contextWindow: 1_000_000,
    id: "gemini-2.5-pro",
    inputPerMillionUsd: 1.25,
    maxOutputTokens: 8192,
    name: "Gemini 2.5 Pro",
    outputPerMillionUsd: 5,
    provider: "gemini",
  },
  {
    contextWindow: 1_000_000,
    default: true,
    id: "deepseek-v4-flash",
    inputPerMillionUsd: 0.14,
    maxOutputTokens: 384_000,
    name: "DeepSeek V4 Flash",
    outputPerMillionUsd: 0.28,
    provider: "deepseek",
    supportsThinking: true,
  },
  {
    contextWindow: 1_000_000,
    id: "deepseek-v4-pro",
    inputPerMillionUsd: 0.435,
    maxOutputTokens: 384_000,
    name: "DeepSeek V4 Pro",
    outputPerMillionUsd: 0.87,
    provider: "deepseek",
    supportsThinking: true,
  },
  {
    contextWindow: 131_072,
    default: true,
    id: "gpt-oss-120b",
    inputPerMillionUsd: 0.35,
    maxOutputTokens: 40_960,
    name: "OpenAI GPT OSS",
    outputPerMillionUsd: 0.75,
    provider: "cerebras",
    supportsThinking: true,
    supportsVision: false,
  },
  {
    contextWindow: 131_072,
    id: "gemma-4-31b",
    inputPerMillionUsd: 0.99,
    maxOutputTokens: 40_960,
    name: "Gemma 4 31B",
    outputPerMillionUsd: 1.49,
    provider: "cerebras",
    supportsThinking: true,
    supportsVision: true,
  },
  {
    contextWindow: 131_072,
    id: "zai-glm-4.7",
    inputPerMillionUsd: 2.25,
    maxOutputTokens: 40_960,
    name: "Z.ai GLM 4.7",
    outputPerMillionUsd: 2.75,
    provider: "cerebras",
    supportsThinking: true,
    supportsVision: false,
  },
  {
    contextWindow: 262_144,
    default: true,
    id: "accounts/fireworks/models/kimi-k2p6",
    inputPerMillionUsd: 0.6,
    maxOutputTokens: 65_536,
    name: "Kimi K2.6",
    outputPerMillionUsd: 2.5,
    provider: "fireworks",
    supportsThinking: true,
    supportsVision: false,
  },
  {
    contextWindow: 131_072,
    id: "accounts/fireworks/models/glm-5p2",
    inputPerMillionUsd: 0.55,
    maxOutputTokens: 40_960,
    name: "GLM 5.2",
    outputPerMillionUsd: 2.19,
    provider: "fireworks",
    supportsThinking: true,
    supportsVision: false,
  },
  {
    contextWindow: 131_072,
    id: "accounts/fireworks/models/gpt-oss-120b",
    inputPerMillionUsd: 0.15,
    maxOutputTokens: 40_960,
    name: "GPT OSS 120B",
    outputPerMillionUsd: 0.6,
    provider: "fireworks",
    supportsThinking: true,
    supportsVision: false,
  },
  {
    contextWindow: 262_144,
    id: "accounts/fireworks/models/kimi-k2p5",
    inputPerMillionUsd: 0.6,
    maxOutputTokens: 65_536,
    name: "Kimi K2.5",
    outputPerMillionUsd: 2.5,
    provider: "fireworks",
    supportsThinking: true,
    supportsVision: true,
  },
  {
    contextWindow: 204_800,
    id: "opencode-go/glm-5.1",
    inputPerMillionUsd: 1.4,
    maxOutputTokens: 131_072,
    name: "GLM 5.1",
    outputPerMillionUsd: 4.4,
    provider: "opencode_go",
  },
  {
    contextWindow: 204_800,
    id: "opencode-go/glm-5",
    inputPerMillionUsd: 1,
    maxOutputTokens: 131_072,
    name: "GLM 5",
    outputPerMillionUsd: 3.2,
    provider: "opencode_go",
  },
  {
    contextWindow: 262_144,
    default: true,
    id: "opencode-go/kimi-k2.7-code",
    inputPerMillionUsd: 0.95,
    maxOutputTokens: 262_144,
    name: "Kimi K2.7 Code",
    outputPerMillionUsd: 4,
    provider: "opencode_go",
  },
  {
    contextWindow: 262_144,
    id: "opencode-go/kimi-k2.6",
    inputPerMillionUsd: 0.95,
    maxOutputTokens: 65_536,
    name: "Kimi K2.6",
    outputPerMillionUsd: 4,
    provider: "opencode_go",
  },
  {
    contextWindow: 1_000_000,
    id: "opencode-go/deepseek-v4-pro",
    inputPerMillionUsd: 1.74,
    maxOutputTokens: 384_000,
    name: "DeepSeek V4 Pro",
    outputPerMillionUsd: 3.48,
    provider: "opencode_go",
  },
  {
    contextWindow: 1_000_000,
    id: "opencode-go/deepseek-v4-flash",
    inputPerMillionUsd: 0.14,
    maxOutputTokens: 384_000,
    name: "DeepSeek V4 Flash",
    outputPerMillionUsd: 0.28,
    provider: "opencode_go",
  },
  {
    contextWindow: 262_144,
    id: "opencode-go/mimo-v2.5",
    inputPerMillionUsd: 0.14,
    maxOutputTokens: 65_536,
    name: "MiMo V2.5",
    outputPerMillionUsd: 0.28,
    provider: "opencode_go",
  },
  {
    contextWindow: 262_144,
    id: "opencode-go/mimo-v2.5-pro",
    inputPerMillionUsd: 1.74,
    maxOutputTokens: 65_536,
    name: "MiMo V2.5 Pro",
    outputPerMillionUsd: 3.48,
    provider: "opencode_go",
  },
  {
    contextWindow: 256_000,
    id: "opencode-go/minimax-m3",
    inputPerMillionUsd: 0.3,
    maxOutputTokens: 64_000,
    name: "MiniMax M3",
    outputPerMillionUsd: 1.2,
    provider: "opencode_go",
  },
  {
    contextWindow: 204_800,
    id: "opencode-go/minimax-m2.7",
    inputPerMillionUsd: 0.3,
    maxOutputTokens: 131_072,
    name: "MiniMax M2.7",
    outputPerMillionUsd: 1.2,
    provider: "opencode_go",
  },
  {
    contextWindow: 204_800,
    id: "opencode-go/minimax-m2.5",
    inputPerMillionUsd: 0.3,
    maxOutputTokens: 131_072,
    name: "MiniMax M2.5",
    outputPerMillionUsd: 1.2,
    provider: "opencode_go",
  },
  {
    contextWindow: 262_144,
    id: "opencode-go/qwen3.7-max",
    inputPerMillionUsd: 2.5,
    maxOutputTokens: 65_536,
    name: "Qwen3.7 Max",
    outputPerMillionUsd: 7.5,
    provider: "opencode_go",
  },
  {
    contextWindow: 262_144,
    id: "opencode-go/qwen3.7-plus",
    inputPerMillionUsd: 0.4,
    maxOutputTokens: 65_536,
    name: "Qwen3.7 Plus",
    outputPerMillionUsd: 1.6,
    provider: "opencode_go",
  },
  {
    contextWindow: 262_144,
    id: "opencode-go/qwen3.6-plus",
    inputPerMillionUsd: 0.5,
    maxOutputTokens: 65_536,
    name: "Qwen3.6 Plus",
    outputPerMillionUsd: 3,
    provider: "opencode_go",
  },
  {
    contextWindow: 262_144,
    id: "opencode-go/qwen3.5-plus",
    inputPerMillionUsd: 0.2,
    maxOutputTokens: 65_536,
    name: "Qwen3.5 Plus",
    outputPerMillionUsd: 1.2,
    provider: "opencode_go",
  },
  {
    contextWindow: 128_000,
    default: true,
    id: "@cf/meta/llama-3.1-8b-instruct",
    inputPerMillionUsd: 0,
    maxOutputTokens: 4096,
    name: "Llama 3.1 8B",
    outputPerMillionUsd: 0,
    provider: "cloudflare",
  },
  {
    contextWindow: 128_000,
    id: "@cf/meta/llama-3.1-8b-instruct-fast",
    inputPerMillionUsd: 0,
    maxOutputTokens: 4096,
    name: "Llama 3.1 8B (Fast)",
    outputPerMillionUsd: 0,
    provider: "cloudflare",
  },
  {
    contextWindow: 128_000,
    id: "@cf/meta/llama-3.1-70b-instruct",
    inputPerMillionUsd: 0.59,
    maxOutputTokens: 4096,
    name: "Llama 3.1 70B",
    outputPerMillionUsd: 0.79,
    provider: "cloudflare",
  },
  {
    contextWindow: 128_000,
    id: "@cf/meta/llama-3.3-70b-instruct",
    inputPerMillionUsd: 0.59,
    maxOutputTokens: 4096,
    name: "Llama 3.3 70B",
    outputPerMillionUsd: 0.79,
    provider: "cloudflare",
  },
  {
    contextWindow: 32_000,
    id: "@cf/qwen/qwen1.5-14b-chat-awq",
    inputPerMillionUsd: 0.19,
    maxOutputTokens: 4096,
    name: "Qwen 1.5 14B",
    outputPerMillionUsd: 0.29,
    provider: "cloudflare",
  },
  {
    contextWindow: 128_000,
    id: "@cf/meta/llama-3.1-8b-instruct-awq",
    inputPerMillionUsd: 0,
    maxOutputTokens: 4096,
    name: "Llama 3.1 8B (AWQ)",
    outputPerMillionUsd: 0,
    provider: "cloudflare",
  },
]);

const OPENROUTER_MODEL_SLUG_PATTERN = /^[\w.-]+\/[\w.:-]+$/;

export function isOpenRouterModelSlug(model: string): boolean {
  return OPENROUTER_MODEL_SLUG_PATTERN.test(model.trim());
}

export function validateOpenRouterCustomModels(
  entries: unknown
): CustomModelEntry[] {
  const models = validateCustomModels(entries);

  for (const model of models) {
    if (!isOpenRouterModelSlug(model.id)) {
      throw new Error(
        `Invalid OpenRouter model id "${model.id}". Use vendor/model format.`
      );
    }
  }

  return models;
}

export function validateCerebrasCustomModels(
  entries: unknown
): CustomModelEntry[] {
  return validateCustomModels(entries);
}

export function validateFireworksCustomModels(
  entries: unknown
): CustomModelEntry[] {
  const models = validateCustomModels(entries);

  if (!models.length) {
    throw new Error("At least one Fireworks model is required.");
  }

  return models;
}

export function validateOllamaCustomModels(
  entries: unknown
): CustomModelEntry[] {
  const models = validateCustomModels(entries);

  if (!models.length) {
    throw new Error("At least one Ollama model is required.");
  }

  return models;
}

export function isOpenCodeGoModelId(model: string): boolean {
  return model.trim().startsWith("opencode-go/");
}

export function validateOpenCodeGoCustomModels(
  entries: unknown
): CustomModelEntry[] {
  const models = validateCustomModels(entries);

  for (const model of models) {
    if (!isOpenCodeGoModelId(model.id)) {
      throw new Error(
        `Invalid OpenCode Go model id "${model.id}". Use opencode-go/model format.`
      );
    }
  }

  return models;
}

export function getAvailableModels(): ProviderModelOption[] {
  return AVAILABLE_MODELS;
}

export function getModelById(modelId: string): ProviderModelOption | undefined {
  return AVAILABLE_MODELS.find((model) => model.id === modelId);
}

export function getModelsForProvider(
  provider: ProviderName
): ProviderModelOption[] {
  return AVAILABLE_MODELS.filter((model) => model.provider === provider);
}

export function getDefaultModel(
  provider: ProviderName,
  customModels?: CustomModelEntry[]
): string {
  if (provider === "openai_compatible") {
    return resolveCompatibleDefaultModel(customModels);
  }

  if (provider === "openrouter" && customModels?.length) {
    return resolveOpenRouterDefaultModel(customModels);
  }

  if (provider === "cerebras" && customModels?.length) {
    return resolveCerebrasDefaultModel(customModels);
  }

  if (provider === "fireworks" && customModels?.length) {
    return resolveFireworksDefaultModel(customModels);
  }

  if (provider === "ollama" && customModels?.length) {
    return resolveOllamaDefaultModel(customModels);
  }

  if (
    (provider === "openai" ||
      provider === "anthropic" ||
      provider === "gemini" ||
      provider === "deepseek" ||
      provider === "opencode_go") &&
    customModels?.length
  ) {
    return resolveCompatibleDefaultModel(customModels, undefined);
  }

  const models = getModelsForProvider(provider);
  const fallback =
    provider === "openrouter"
      ? "anthropic/claude-sonnet-4-6"
      : provider === "anthropic"
        ? "claude-sonnet-4-6"
        : provider === "gemini"
          ? "gemini-2.5-flash"
          : provider === "deepseek"
            ? "deepseek-v4-flash"
            : provider === "cerebras"
              ? "gpt-oss-120b"
              : provider === "fireworks"
                ? "accounts/fireworks/models/kimi-k2p6"
                : provider === "opencode_go"
                  ? "opencode-go/kimi-k2.7-code"
                  : "gpt-5.4";
  return models.find((model) => model.default)?.id ?? models[0]?.id ?? fallback;
}

export function isValidModel(model: string): boolean {
  return AVAILABLE_MODELS.some((option) => option.id === model);
}

export function resolveModel(
  provider: ProviderName,
  model?: string,
  customModels?: CustomModelEntry[]
): string {
  const trimmed = model?.trim();

  if (trimmed && provider === "openrouter" && isOpenRouterModelSlug(trimmed)) {
    return trimmed;
  }

  if (trimmed && provider === "cerebras" && customModels?.length) {
    if (findCustomModel(customModels, trimmed)) {
      return trimmed;
    }

    return resolveCerebrasDefaultModel(customModels, trimmed);
  }

  if (trimmed && provider === "fireworks" && customModels?.length) {
    if (findCustomModel(customModels, trimmed)) {
      return trimmed;
    }

    return resolveFireworksDefaultModel(customModels, trimmed);
  }

  if (trimmed && provider === "ollama" && customModels?.length) {
    if (findCustomModel(customModels, trimmed)) {
      return trimmed;
    }

    return resolveOllamaDefaultModel(customModels, trimmed);
  }

  if (trimmed && provider === "openai_compatible") {
    if (findCustomModel(customModels, trimmed)) {
      return trimmed;
    }

    return resolveCompatibleDefaultModel(customModels, trimmed);
  }

  if (
    trimmed &&
    (provider === "openai" ||
      provider === "anthropic" ||
      provider === "gemini" ||
      provider === "deepseek" ||
      provider === "cerebras" ||
      provider === "fireworks" ||
      provider === "opencode_go") &&
    customModels?.length
  ) {
    if (findCustomModel(customModels, trimmed)) {
      return trimmed;
    }

    return resolveCompatibleDefaultModel(customModels, trimmed);
  }

  if (trimmed && isValidModel(trimmed)) {
    const option = getModelById(trimmed);

    if (option?.provider === provider) {
      return trimmed;
    }
  }

  if (
    trimmed &&
    (provider === "openai" ||
      provider === "anthropic" ||
      provider === "gemini" ||
      provider === "opencode_go")
  ) {
    return trimmed;
  }

  return getDefaultModel(provider, customModels);
}

export function modelSupportsVision(
  modelId: string,
  provider: ProviderName,
  customModels?: CustomModelEntry[]
): boolean | undefined {
  const custom = findCustomModel(customModels, modelId);

  if (custom?.supportsVision !== undefined) {
    return custom.supportsVision;
  }

  if (
    provider === "openai_compatible" ||
    provider === "opencode_go" ||
    provider === "deepseek"
  ) {
    return false;
  }

  if (
    provider === "cerebras" ||
    provider === "fireworks" ||
    provider === "ollama"
  ) {
    if (custom?.supportsVision !== undefined) {
      return custom.supportsVision;
    }

    const catalog = getModelById(modelId);
    return catalog?.supportsVision ?? false;
  }

  const catalog = getModelById(modelId);

  if (catalog?.supportsVision !== undefined) {
    return catalog.supportsVision;
  }

  if (
    provider === "openai" ||
    provider === "anthropic" ||
    provider === "gemini"
  ) {
    return true;
  }
}

export const TRANSCRIPTION_MODEL_IDS = new Set([
  "whisper-1",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
]);

export function modelSupportsTranscription(
  modelId: string,
  provider: ProviderName
): boolean {
  if (provider !== "openai") {
    return false;
  }

  return TRANSCRIPTION_MODEL_IDS.has(modelId.trim());
}

/** Sole v1 image-generation model id (OpenAI Images API). */
export const IMAGE_GENERATION_MODEL_ID = "gpt-image-2";

/** Sole allowlisted workspace selection: provider type + model id. */
export const IMAGE_GENERATION_SELECTION = `openai::${IMAGE_GENERATION_MODEL_ID}`;

export const IMAGE_GENERATION_MODEL_IDS = new Set([IMAGE_GENERATION_MODEL_ID]);

export function modelSupportsImageGeneration(
  modelId: string,
  provider: ProviderName
): boolean {
  if (provider !== "openai") {
    return false;
  }

  return IMAGE_GENERATION_MODEL_IDS.has(modelId.trim());
}

export function isAllowedImageGenerationSelection(
  value: string | null | undefined
): boolean {
  return value?.trim() === IMAGE_GENERATION_SELECTION;
}
