import type { ProviderName } from "@tinyclaw/core";

export interface ProviderModelOption {
  id: string;
  name: string;
  provider: ProviderName;
  contextWindow: number;
  maxOutputTokens: number;
  default?: boolean;
  /** OpenRouter only: whether extended thinking (`reasoning`) is sent for this model. */
  supportsThinking?: boolean;
}

export const AVAILABLE_MODELS: ProviderModelOption[] = [
  {
    id: "claude-sonnet-4-6",
    name: "Sonnet 4.6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    default: true,
  },
  {
    id: "claude-opus-4-6",
    name: "Opus 4.6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    provider: "openai",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    provider: "openai",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    default: true,
  },
  {
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    provider: "openai",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "openrouter",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    default: true,
    supportsThinking: true,
  },
  {
    id: "anthropic/claude-opus-4-6",
    name: "Claude Opus 4.6",
    provider: "openrouter",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsThinking: true,
  },
  {
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
    provider: "openrouter",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: true,
  },
  {
    id: "google/gemini-2.5-pro-preview",
    name: "Gemini 2.5 Pro",
    provider: "openrouter",
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    supportsThinking: true,
  },
  {
    id: "meta-llama/llama-4-maverick",
    name: "Llama 4 Maverick",
    provider: "openrouter",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "gemini",
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    default: true,
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "gemini",
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
  },
];

const OPENROUTER_MODEL_SLUG_PATTERN = /^[\w.-]+\/[\w.:-]+$/;

export function isOpenRouterModelSlug(model: string): boolean {
  return OPENROUTER_MODEL_SLUG_PATTERN.test(model.trim());
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

export function getDefaultModel(provider: ProviderName): string {
  const models = getModelsForProvider(provider);
  const fallback =
    provider === "openrouter"
      ? "anthropic/claude-sonnet-4-6"
      : provider === "anthropic"
        ? "claude-sonnet-4-6"
        : provider === "gemini"
          ? "gemini-2.5-flash"
          : "gpt-5.4";
  return models.find((model) => model.default)?.id ?? models[0]?.id ?? fallback;
}

export function isValidModel(model: string): boolean {
  return AVAILABLE_MODELS.some((option) => option.id === model);
}

export function resolveModel(
  provider: ProviderName,
  model?: string,
): string {
  const trimmed = model?.trim();

  if (trimmed && provider === "openrouter" && isOpenRouterModelSlug(trimmed)) {
    return trimmed;
  }

  if (trimmed && isValidModel(trimmed)) {
    const option = getModelById(trimmed);

    if (option?.provider === provider) {
      return trimmed;
    }
  }

  return getDefaultModel(provider);
}
