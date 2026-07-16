import { findCustomModel, type ProviderInstance, type ProviderName } from "@nakama/core";
import { getModelById } from "./models";

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

export interface PricingContext {
  provider?: ProviderName | null;
  providerInstance?: ProviderInstance | null;
}

function getCustomModelPricing(
  modelId: string,
  context: PricingContext,
): ModelPricing | null {
  const entry = findCustomModel(context.providerInstance?.customModels, modelId);

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

export function getModelPricing(
  modelId: string,
  context: PricingContext = {},
): ModelPricing | null {
  const provider = context.provider ?? context.providerInstance?.type ?? null;

  if (provider === "openai_compatible" || provider === "openrouter" || provider === "cerebras") {
    return getCustomModelPricing(modelId, context);
  }

  const catalog = getModelById(modelId);

  if (catalog?.inputPerMillionUsd != null && catalog.outputPerMillionUsd != null) {
    return {
      inputPerMillionUsd: catalog.inputPerMillionUsd,
      outputPerMillionUsd: catalog.outputPerMillionUsd,
    };
  }

  return DEFAULT_PRICING;
}

export function estimateUsageCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  context: PricingContext = {},
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
  context: PricingContext = {},
): boolean {
  return getModelPricing(modelId, context) !== null;
}

export function isCostEstimated(
  provider: ProviderName | null,
  modelId: string | null,
  providerInstance: ProviderInstance | null | undefined,
): boolean {
  if (!provider || !modelId) {
    return false;
  }

  return hasCatalogPricing(modelId, { provider, providerInstance });
}
