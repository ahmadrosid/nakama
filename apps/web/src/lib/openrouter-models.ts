import type { ProviderModelOption } from "@nakama/core/contract";

export interface OpenRouterApiPricing {
  completion?: string;
  image?: string;
  input_cache_read?: string;
  input_cache_write?: string;
  internal_reasoning?: string;
  prompt?: string;
  request?: string;
  web_search?: string;
}

export interface OpenRouterApiModel {
  architecture?: {
    input_modalities?: string[];
  };
  context_length?: number;
  description?: string;
  expiration_date?: string | null;
  id: string;
  name: string;
  pricing?: OpenRouterApiPricing;
  supported_parameters?: string[];
}

export interface OpenRouterModelsApiResponse {
  data?: OpenRouterApiModel[];
}

export interface OpenRouterModelRow {
  contextLength: number;
  deprecated: boolean;
  description: string;
  id: string;
  inputPerMillionUsd?: number;
  isFree: boolean;
  name: string;
  outputPerMillionUsd?: number;
  reasoning: boolean;
  tools: boolean;
  vision: boolean;
}

/** OpenRouter API prices are USD per token; convert to USD per 1M tokens. */
export function openRouterPricingPerMillion(
  pricing: OpenRouterApiPricing | undefined
):
  | Pick<OpenRouterModelRow, "inputPerMillionUsd" | "outputPerMillionUsd">
  | undefined {
  if (!(pricing?.prompt && pricing?.completion)) {
    return;
  }

  const inputPerMillionUsd = Number.parseFloat(pricing.prompt) * 1_000_000;
  const outputPerMillionUsd = Number.parseFloat(pricing.completion) * 1_000_000;

  if (
    !(
      Number.isFinite(inputPerMillionUsd) &&
      Number.isFinite(outputPerMillionUsd)
    )
  ) {
    return;
  }

  return { inputPerMillionUsd, outputPerMillionUsd };
}

export function isOpenRouterModelFree(
  pricing: OpenRouterApiPricing | undefined
): boolean {
  if (!pricing) {
    return false;
  }

  const prompt = Number.parseFloat(pricing.prompt ?? "1");
  const completion = Number.parseFloat(pricing.completion ?? "1");
  return prompt === 0 && completion === 0;
}

/** OpenRouter uses 2098-12-31 as a placeholder on live stealth/preview models. */
const OPENROUTER_SENTINEL_EXPIRATION_YEAR = 2090;

export function isOpenRouterModelDeprecated(
  expirationDate: string | null | undefined
): boolean {
  if (!expirationDate) {
    return false;
  }

  const year = Number.parseInt(expirationDate.slice(0, 4), 10);
  return Number.isFinite(year) && year < OPENROUTER_SENTINEL_EXPIRATION_YEAR;
}

export function normalizeOpenRouterModel(
  entry: OpenRouterApiModel
): OpenRouterModelRow {
  const inputModalities = entry.architecture?.input_modalities ?? [];
  const supported = entry.supported_parameters ?? [];
  const perMillion = openRouterPricingPerMillion(entry.pricing);

  return {
    contextLength: entry.context_length ?? 0,
    deprecated: isOpenRouterModelDeprecated(entry.expiration_date),
    description: truncateDescription(entry.description ?? ""),
    id: entry.id,
    isFree: isOpenRouterModelFree(entry.pricing),
    name: entry.name,
    reasoning:
      supported.includes("reasoning") ||
      supported.includes("include_reasoning"),
    tools: supported.includes("tools"),
    vision: inputModalities.includes("image"),
    ...(perMillion ?? {}),
  };
}

export function normalizeOpenRouterModels(
  apiJson: OpenRouterModelsApiResponse
): OpenRouterModelRow[] {
  const data = apiJson.data ?? [];
  return data.map(normalizeOpenRouterModel).sort(compareOpenRouterModelRows);
}

export function compareOpenRouterModelRows(
  a: OpenRouterModelRow,
  b: OpenRouterModelRow
): number {
  if (a.isFree !== b.isFree) {
    return a.isFree ? -1 : 1;
  }

  return a.name.localeCompare(b.name);
}

export function mergeOpenRouterModelOptions(
  models: ProviderModelOption[],
  currentModelId: string | undefined,
  displayName?: string
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
