import {
  findCustomModel,
  type ProviderInstance,
  type ProviderName,
} from "@nakama/core";
import { DISCOVERY_MODEL_PROVIDERS } from "@nakama/core/discovery-providers";
import { getModelById, IMAGE_GENERATION_MODEL_ID } from "./models";

export interface ModelPricing {
  /** USD per 1M input tokens */
  inputPerMillionUsd: number;
  /** USD per 1M output tokens */
  outputPerMillionUsd: number;
}

const DEFAULT_PRICING: ModelPricing = {
  inputPerMillionUsd: 1,
  outputPerMillionUsd: 3,
};

/**
 * Token-shaped pricing bridge for Images API models.
 * gpt-image-2: text input $5/MTok, image output $30/MTok (OpenAI list pricing).
 * Image-input rates are unused for v1 generate-only calls.
 */
const IMAGE_GENERATION_PRICING: Record<string, ModelPricing> = {
  [IMAGE_GENERATION_MODEL_ID]: {
    inputPerMillionUsd: 5,
    outputPerMillionUsd: 30,
  },
};

export interface PricingContext {
  provider?: ProviderName | null;
  providerInstance?: ProviderInstance | null;
}

function getCustomModelPricing(
  modelId: string,
  context: PricingContext
): ModelPricing | null {
  const entry = findCustomModel(
    context.providerInstance?.customModels,
    modelId
  );

  if (
    entry?.inputPerMillionUsd !== undefined &&
    entry.outputPerMillionUsd !== undefined
  ) {
    return {
      inputPerMillionUsd: entry.inputPerMillionUsd,
      outputPerMillionUsd: entry.outputPerMillionUsd,
    };
  }

  return null;
}

/**
 * Providers whose rates only ever come from what the user typed in. Discovery
 * providers belong here by construction: their catalogs are fetched from the
 * platform at runtime, so there is never a bundled entry to price against and
 * DEFAULT_PRICING would be a guess presented as a rate.
 */
const USER_PRICED_PROVIDERS = new Set<ProviderName>([
  ...DISCOVERY_MODEL_PROVIDERS,
  "cerebras",
  "fireworks",
  "ollama",
  "openrouter",
]);

function isUserPriced(context: PricingContext): boolean {
  const provider = context.provider ?? context.providerInstance?.type ?? null;
  return provider !== null && USER_PRICED_PROVIDERS.has(provider);
}

/**
 * Rates somebody actually published for this model: the image table, the
 * catalog entry, or what the user typed for a custom model. Null when the only
 * number available would be DEFAULT_PRICING, so a caller that shows money to a
 * user can tell a real rate from a house guess.
 */
export function getExplicitModelPricing(
  modelId: string,
  context: PricingContext = {}
): ModelPricing | null {
  const imagePricing = IMAGE_GENERATION_PRICING[modelId];
  if (imagePricing) {
    return imagePricing;
  }

  if (isUserPriced(context)) {
    return getCustomModelPricing(modelId, context);
  }

  const catalog = getModelById(modelId);

  if (
    catalog?.inputPerMillionUsd != null &&
    catalog.outputPerMillionUsd != null
  ) {
    return {
      inputPerMillionUsd: catalog.inputPerMillionUsd,
      outputPerMillionUsd: catalog.outputPerMillionUsd,
    };
  }

  return null;
}

export function getModelPricing(
  modelId: string,
  context: PricingContext = {}
): ModelPricing | null {
  const explicit = getExplicitModelPricing(modelId, context);

  if (explicit) {
    return explicit;
  }

  return isUserPriced(context) ? null : DEFAULT_PRICING;
}

export function estimateUsageCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  context: PricingContext = {}
): number {
  const pricing = getModelPricing(modelId, context);

  if (!pricing) {
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillionUsd;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillionUsd;
  return inputCost + outputCost;
}

export function hasCatalogPricing(
  modelId: string,
  context: PricingContext = {}
): boolean {
  return getModelPricing(modelId, context) !== null;
}

export function isCostEstimated(
  provider: ProviderName | null,
  modelId: string | null,
  providerInstance: ProviderInstance | null | undefined
): boolean {
  if (!(provider && modelId)) {
    return false;
  }

  return hasCatalogPricing(modelId, { provider, providerInstance });
}
