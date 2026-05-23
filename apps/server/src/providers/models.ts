import type { ProviderName } from "@tinyclaw/core";

export interface ProviderModelOption {
  id: string;
  name: string;
  provider: ProviderName;
  default?: boolean;
}

export const AVAILABLE_MODELS: ProviderModelOption[] = [
  { id: "claude-sonnet-4-6", name: "Sonnet 4.6", provider: "anthropic" },
  { id: "claude-opus-4-6", name: "Opus 4.6", provider: "anthropic" },
  { id: "gpt-5.5", name: "GPT-5.5", provider: "openai" },
  { id: "gpt-5.4", name: "GPT-5.4", provider: "openai", default: true },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", provider: "openai" },
];

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
  return models.find((model) => model.default)?.id ?? models[0]?.id ?? "gpt-5.4";
}

export function isValidModel(model: string): boolean {
  return AVAILABLE_MODELS.some((option) => option.id === model);
}

export function resolveModel(
  provider: ProviderName,
  model?: string,
): string {
  if (model && isValidModel(model)) {
    const option = getModelById(model);

    if (option?.provider === provider) {
      return model;
    }
  }

  return getDefaultModel(provider);
}
