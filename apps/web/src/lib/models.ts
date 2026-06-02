import type { ProviderModelOption } from "@tinyclaw/core/contract";
import type { UserProviderName } from "@tinyclaw/core/provider-resolution";

export type SelectedProvider = UserProviderName;

export const OPENROUTER_MODEL_SLUG_PATTERN = /^[\w.-]+\/[\w.:-]+$/;

export function isOpenRouterModelSlug(model: string): boolean {
  return OPENROUTER_MODEL_SLUG_PATTERN.test(model.trim());
}

export function filterModelsByProvider(
  models: ProviderModelOption[],
  provider: SelectedProvider | null | undefined,
): ProviderModelOption[] {
  if (!provider) {
    return models;
  }

  return models.filter((model) => model.provider === provider);
}

export function defaultModelForProvider(
  models: ProviderModelOption[],
  provider: SelectedProvider,
): string {
  const providerModels = filterModelsByProvider(models, provider);
  return (
    providerModels.find((model) => model.default)?.id ??
    providerModels[0]?.id ??
    ""
  );
}

export function formatProviderLabel(provider: string | null | undefined): string {
  if (provider === "openai") {
    return "OpenAI";
  }

  if (provider === "anthropic") {
    return "Anthropic";
  }

  if (provider === "openrouter") {
    return "OpenRouter";
  }

  if (provider === "gemini") {
    return "Gemini";
  }

  return provider ?? "Provider";
}

export const PROVIDER_OPTIONS: Array<{ id: SelectedProvider; label: string }> = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "gemini", label: "Gemini" },
];

export function apiKeyPlaceholder(provider: SelectedProvider): string {
  if (provider === "anthropic") {
    return "sk-ant-…";
  }

  if (provider === "openrouter") {
    return "sk-or-v1-…";
  }

  if (provider === "gemini") {
    return "AIza…";
  }

  return "sk-…";
}

export function validateApiKeyForProvider(apiKey: string): string | null {
  if (!apiKey.trim()) {
    return "API key is required.";
  }

  return null;
}

export function validateCustomOpenRouterModel(model: string): string | null {
  const trimmed = model.trim();

  if (!trimmed) {
    return null;
  }

  if (!isOpenRouterModelSlug(trimmed)) {
    return "Use vendor/model format, e.g. anthropic/claude-sonnet-4-6";
  }

  return null;
}

export function getModelDisplayName(
  models: ProviderModelOption[],
  modelId: string | null | undefined,
): string {
  if (!modelId) {
    return "Unknown";
  }

  return models.find((model) => model.id === modelId)?.name ?? modelId;
}

export function resolveModelForProvider(
  provider: SelectedProvider,
  catalogModel: string,
  customModel?: string,
): string {
  const custom = customModel?.trim();

  if (provider === "openrouter" && custom) {
    return custom;
  }

  return catalogModel;
}
