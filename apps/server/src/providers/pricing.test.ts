import { describe, expect, test } from "bun:test";
import { estimateUsageCostUsd, getModelPricing, hasCatalogPricing } from "./pricing";

const openRouterInstance = {
  id: "or-1",
  type: "openrouter" as const,
  label: "OpenRouter",
  apiKey: "sk-test",
  createdAt: "2026-06-07T10:00:00.000Z",
};

const compatibleInstance = {
  id: "cmp-1",
  type: "openai_compatible" as const,
  label: "Ollama",
  apiKey: "k",
  baseUrl: "http://localhost:11434/v1",
  createdAt: "2026-06-07T10:00:00.000Z",
};

const cerebrasInstance = {
  id: "cb-1",
  type: "cerebras" as const,
  label: "Cerebras",
  apiKey: "csk-test",
  createdAt: "2026-07-16T10:00:00.000Z",
};

describe("estimateUsageCostUsd", () => {
  test("computes cost from catalog pricing", () => {
    const cost = estimateUsageCostUsd("claude-sonnet-4-6", 1_000_000, 1_000_000);
    expect(cost).toBe(18);
  });

  test("uses fallback pricing for unknown models", () => {
    const pricing = getModelPricing("vendor/custom-model");
    expect(pricing?.inputPerMillionUsd).toBe(1);
    expect(pricing?.outputPerMillionUsd).toBe(3);
  });

  test("uses saved pricing for openrouter custom models", () => {
    const cost = estimateUsageCostUsd("anthropic/claude-sonnet-4-6", 1_000_000, 1_000_000, {
      provider: "openrouter",
      providerInstance: {
        ...openRouterInstance,
        customModels: [
          {
            id: "anthropic/claude-sonnet-4-6",
            inputPerMillionUsd: 3,
            outputPerMillionUsd: 15,
          },
        ],
      },
    });

    expect(cost).toBe(18);
  });

  test("does not estimate openrouter models without saved pricing", () => {
    expect(
      getModelPricing("anthropic/claude-sonnet-4-6", {
        provider: "openrouter",
        providerInstance: {
          ...openRouterInstance,
          customModels: [{ id: "anthropic/claude-sonnet-4-6" }],
        },
      }),
    ).toBeNull();
    expect(
      estimateUsageCostUsd("anthropic/claude-sonnet-4-6", 1_000, 500, {
        provider: "openrouter",
        providerInstance: {
          ...openRouterInstance,
          customModels: [{ id: "anthropic/claude-sonnet-4-6" }],
        },
      }),
    ).toBe(0);
  });

  test("uses saved pricing for cerebras custom models", () => {
    const cost = estimateUsageCostUsd("gpt-oss-120b", 1_000_000, 1_000_000, {
      provider: "cerebras",
      providerInstance: {
        ...cerebrasInstance,
        customModels: [
          {
            id: "gpt-oss-120b",
            inputPerMillionUsd: 0.25,
            outputPerMillionUsd: 0.69,
          },
        ],
      },
    });

    expect(cost).toBeCloseTo(0.94, 5);
  });

  test("does not estimate compatible models without user pricing", () => {
    const pricing = getModelPricing("llama3.2", {
      provider: "openai_compatible",
      providerInstance: {
        ...compatibleInstance,
        customModels: [{ id: "llama3.2" }],
      },
    });

    expect(pricing).toBeNull();
    expect(
      estimateUsageCostUsd("llama3.2", 1_000, 500, {
        provider: "openai_compatible",
        providerInstance: {
          ...compatibleInstance,
          customModels: [{ id: "llama3.2" }],
        },
      }),
    ).toBe(0);
    expect(
      hasCatalogPricing("llama3.2", {
        provider: "openai_compatible",
        providerInstance: {
          ...compatibleInstance,
          customModels: [
            {
              id: "llama3.2",
              inputPerMillionUsd: 0,
              outputPerMillionUsd: 0,
            },
          ],
        },
      }),
    ).toBe(true);
  });
});
