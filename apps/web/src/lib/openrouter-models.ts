import type { ProviderModelOption } from "@nakama/core/contract";

export interface OpenRouterApiPricing {
  prompt?: string;
  completion?: string;
  request?: string;
  image?: string;
  web_search?: string;
  internal_reasoning?: string;
  input_cache_read?: string;
  input_cache_write?: string;
}

export interface OpenRouterApiModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
  };
  supported_parameters?: string[];
  pricing?: OpenRouterApiPricing;
  expiration_date?: string | null;
}

export interface OpenRouterModelsApiResponse {
  data?: OpenRouterApiModel[];
}

export interface OpenRouterModelRow {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  isFree: boolean;
  deprecated: boolean;
  vision: boolean;
  tools: boolean;
  reasoning: boolean;
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
}

/** OpenRouter API prices are USD per token; convert to USD per 1M tokens. */
export function openRouterPricingPerMillion(
  pricing: OpenRouterApiPricing | undefined,
): Pick<OpenRouterModelRow, "inputPerMillionUsd" | "outputPerMillionUsd"> | undefined {
  if (!pricing?.prompt || !pricing?.completion) {
    return undefined;
  }

  const inputPerMillionUsd = parseFloat(pricing.prompt) * 1_000_000;
  const outputPerMillionUsd = parseFloat(pricing.completion) * 1_000_000;

  if (!Number.isFinite(inputPerMillionUsd) || !Number.isFinite(outputPerMillionUsd)) {
    return undefined;
  }

  return { inputPerMillionUsd, outputPerMillionUsd };
}

export function isOpenRouterModelFree(pricing: OpenRouterApiPricing | undefined): boolean {
  if (!pricing) {
    return false;
  }

  const prompt = parseFloat(pricing.prompt ?? "1");
  const completion = parseFloat(pricing.completion ?? "1");
  return prompt === 0 && completion === 0;
}

export function normalizeOpenRouterModel(entry: OpenRouterApiModel): OpenRouterModelRow {
  const inputModalities = entry.architecture?.input_modalities ?? [];
  const supported = entry.supported_parameters ?? [];
  const perMillion = openRouterPricingPerMillion(entry.pricing);

  return {
    id: entry.id,
    name: entry.name,
    description: truncateDescription(entry.description ?? ""),
    contextLength: entry.context_length ?? 0,
    isFree: isOpenRouterModelFree(entry.pricing),
    deprecated: entry.expiration_date != null,
    vision: inputModalities.includes("image"),
    tools: supported.includes("tools"),
    reasoning: supported.includes("reasoning") || supported.includes("include_reasoning"),
    ...(perMillion ?? {}),
  };
}

export function normalizeOpenRouterModels(
  apiJson: OpenRouterModelsApiResponse,
): OpenRouterModelRow[] {
  const data = apiJson.data ?? [];
  return data.map(normalizeOpenRouterModel).sort(compareOpenRouterModelRows);
}

export function compareOpenRouterModelRows(
  a: OpenRouterModelRow,
  b: OpenRouterModelRow,
): number {
  if (a.isFree !== b.isFree) {
    return a.isFree ? -1 : 1;
  }

  return a.name.localeCompare(b.name);
}

export function mergeOpenRouterModelOptions(
  models: ProviderModelOption[],
  currentModelId: string | undefined,
  displayName?: string,
): ProviderModelOption[] {
  if (!currentModelId || models.some((model) => model.id === currentModelId)) {
    return models;
  }

  return [
    {
      id: currentModelId,
      name: displayName ?? currentModelId,
      provider: "openrouter",
    },
    ...models,
  ];
}

function truncateDescription(text: string, maxLength = 120): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1)}…`;
}
