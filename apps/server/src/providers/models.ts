import {
  findCustomModel,
  validateCustomModels,
  type CustomModelEntry,
} from "@tinyclaw/core";
import type { ProviderName } from "@tinyclaw/core";
import type { ProviderModelOption as ContractProviderModelOption } from "@tinyclaw/core/contract";
import {
  resolveCompatibleDefaultModel,
  resolveOpenRouterDefaultModel,
} from "./compatible-models";

export type ProviderModelOption = ContractProviderModelOption & {
  contextWindow: number;
  maxOutputTokens: number;
};

export const AVAILABLE_MODELS: ProviderModelOption[] = [
  {
    id: "claude-sonnet-4-6",
    name: "Sonnet 4.6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    default: true,
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15,
  },
  {
    id: "claude-opus-4-6",
    name: "Opus 4.6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    inputPerMillionUsd: 15,
    outputPerMillionUsd: 75,
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    provider: "openai",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    inputPerMillionUsd: 2.5,
    outputPerMillionUsd: 10,
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    provider: "openai",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    default: true,
    inputPerMillionUsd: 2,
    outputPerMillionUsd: 8,
  },
  {
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    provider: "openai",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    inputPerMillionUsd: 1.5,
    outputPerMillionUsd: 6,
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "gemini",
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    default: true,
    inputPerMillionUsd: 0.15,
    outputPerMillionUsd: 0.6,
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "gemini",
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 5,
  },
  {
    id: "opencode-go/glm-5.1",
    name: "GLM 5.1",
    provider: "opencode_go",
    contextWindow: 204_800,
    maxOutputTokens: 131_072,
    inputPerMillionUsd: 1.4,
    outputPerMillionUsd: 4.4,
  },
  {
    id: "opencode-go/glm-5",
    name: "GLM 5",
    provider: "opencode_go",
    contextWindow: 204_800,
    maxOutputTokens: 131_072,
    inputPerMillionUsd: 1,
    outputPerMillionUsd: 3.2,
  },
  {
    id: "opencode-go/kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    provider: "opencode_go",
    contextWindow: 262_144,
    maxOutputTokens: 262_144,
    default: true,
    inputPerMillionUsd: 0.95,
    outputPerMillionUsd: 4,
  },
  {
    id: "opencode-go/kimi-k2.6",
    name: "Kimi K2.6",
    provider: "opencode_go",
    contextWindow: 262_144,
    maxOutputTokens: 65_536,
    inputPerMillionUsd: 0.95,
    outputPerMillionUsd: 4,
  },
  {
    id: "opencode-go/deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    provider: "opencode_go",
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    inputPerMillionUsd: 1.74,
    outputPerMillionUsd: 3.48,
  },
  {
    id: "opencode-go/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "opencode_go",
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    inputPerMillionUsd: 0.14,
    outputPerMillionUsd: 0.28,
  },
  {
    id: "opencode-go/mimo-v2.5",
    name: "MiMo V2.5",
    provider: "opencode_go",
    contextWindow: 262_144,
    maxOutputTokens: 65_536,
    inputPerMillionUsd: 0.14,
    outputPerMillionUsd: 0.28,
  },
  {
    id: "opencode-go/mimo-v2.5-pro",
    name: "MiMo V2.5 Pro",
    provider: "opencode_go",
    contextWindow: 262_144,
    maxOutputTokens: 65_536,
    inputPerMillionUsd: 1.74,
    outputPerMillionUsd: 3.48,
  },
  {
    id: "opencode-go/minimax-m3",
    name: "MiniMax M3",
    provider: "opencode_go",
    contextWindow: 256_000,
    maxOutputTokens: 64_000,
    inputPerMillionUsd: 0.3,
    outputPerMillionUsd: 1.2,
  },
  {
    id: "opencode-go/minimax-m2.7",
    name: "MiniMax M2.7",
    provider: "opencode_go",
    contextWindow: 204_800,
    maxOutputTokens: 131_072,
    inputPerMillionUsd: 0.3,
    outputPerMillionUsd: 1.2,
  },
  {
    id: "opencode-go/minimax-m2.5",
    name: "MiniMax M2.5",
    provider: "opencode_go",
    contextWindow: 204_800,
    maxOutputTokens: 131_072,
    inputPerMillionUsd: 0.3,
    outputPerMillionUsd: 1.2,
  },
  {
    id: "opencode-go/qwen3.7-max",
    name: "Qwen3.7 Max",
    provider: "opencode_go",
    contextWindow: 262_144,
    maxOutputTokens: 65_536,
    inputPerMillionUsd: 2.5,
    outputPerMillionUsd: 7.5,
  },
  {
    id: "opencode-go/qwen3.7-plus",
    name: "Qwen3.7 Plus",
    provider: "opencode_go",
    contextWindow: 262_144,
    maxOutputTokens: 65_536,
    inputPerMillionUsd: 0.4,
    outputPerMillionUsd: 1.6,
  },
  {
    id: "opencode-go/qwen3.6-plus",
    name: "Qwen3.6 Plus",
    provider: "opencode_go",
    contextWindow: 262_144,
    maxOutputTokens: 65_536,
    inputPerMillionUsd: 0.5,
    outputPerMillionUsd: 3,
  },
  {
    id: "opencode-go/qwen3.5-plus",
    name: "Qwen3.5 Plus",
    provider: "opencode_go",
    contextWindow: 262_144,
    maxOutputTokens: 65_536,
    inputPerMillionUsd: 0.2,
    outputPerMillionUsd: 1.2,
  },
];

const OPENROUTER_MODEL_SLUG_PATTERN = /^[\w.-]+\/[\w.:-]+$/;

export function isOpenRouterModelSlug(model: string): boolean {
  return OPENROUTER_MODEL_SLUG_PATTERN.test(model.trim());
}

export function validateOpenRouterCustomModels(entries: unknown): CustomModelEntry[] {
  const models = validateCustomModels(entries);

  for (const model of models) {
    if (!isOpenRouterModelSlug(model.id)) {
      throw new Error(
        `Invalid OpenRouter model id "${model.id}". Use vendor/model format.`,
      );
    }
  }

  return models;
}

export function isOpenCodeGoModelId(model: string): boolean {
  return model.trim().startsWith("opencode-go/");
}

export function validateOpenCodeGoCustomModels(entries: unknown): CustomModelEntry[] {
  const models = validateCustomModels(entries);

  for (const model of models) {
    if (!isOpenCodeGoModelId(model.id)) {
      throw new Error(
        `Invalid OpenCode Go model id "${model.id}". Use opencode-go/model format.`,
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
  provider: ProviderName,
): ProviderModelOption[] {
  return AVAILABLE_MODELS.filter((model) => model.provider === provider);
}

export function getDefaultModel(
  provider: ProviderName,
  customModels?: CustomModelEntry[],
): string {
  if (provider === "openai_compatible") {
    return resolveCompatibleDefaultModel(customModels);
  }

  if (provider === "openrouter" && customModels?.length) {
    return resolveOpenRouterDefaultModel(customModels);
  }

  if (provider === "opencode_go" && customModels?.length) {
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
  customModels?: CustomModelEntry[],
): string {
  const trimmed = model?.trim();

  if (trimmed && provider === "openrouter" && isOpenRouterModelSlug(trimmed)) {
    return trimmed;
  }

  if (trimmed && provider === "openai_compatible") {
    if (findCustomModel(customModels, trimmed)) {
      return trimmed;
    }

    return resolveCompatibleDefaultModel(customModels, trimmed);
  }

  if (trimmed && provider === "opencode_go" && customModels?.length) {
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
