import { describe, expect, test } from "bun:test";
import {
  estimateUsageCostUsd,
  getExplicitModelPricing,
  getModelPricing,
  hasCatalogPricing,
} from "./pricing";

const openRouterInstance = {
  apiKey: "sk-test",
  createdAt: "2026-06-07T10:00:00.000Z",
  id: "or-1",
  label: "OpenRouter",
  type: "openrouter" as const,
};

const compatibleInstance = {
  apiKey: "k",
  baseUrl: "http://localhost:11434/v1",
  createdAt: "2026-06-07T10:00:00.000Z",
  id: "cmp-1",
  label: "Ollama",
  type: "openai_compatible" as const,
};

const cerebrasInstance = {
  apiKey: "csk-test",
  createdAt: "2026-07-16T10:00:00.000Z",
  id: "cb-1",
  label: "Cerebras",
  type: "cerebras" as const,
};

const fireworksInstance = {
  apiKey: "fw-test",
  createdAt: "2026-07-24T10:00:00.000Z",
  id: "fw-1",
  label: "Fireworks",
  type: "fireworks" as const,
};

const moonshotInstance = {
  apiKey: "sk-moonshot-test",
  baseUrl: "https://api.moonshot.ai/v1",
  createdAt: "2026-09-08T10:00:00.000Z",
  id: "ms-1",
  label: "Moonshot Kimi",
  type: "moonshot" as const,
};
describe("estimateUsageCostUsd", () => {
  test("computes cost from catalog pricing", () => {
    const cost = estimateUsageCostUsd(
      "claude-sonnet-4-6",
      1_000_000,
      1_000_000
    );
    expect(cost).toBe(18);
  });

  test("uses fallback pricing for unknown models", () => {
    const pricing = getModelPricing("vendor/custom-model");
    expect(pricing?.inputPerMillionUsd).toBe(1);
    expect(pricing?.outputPerMillionUsd).toBe(3);
  });

  test("prices gpt-image-2 with Images token rates", () => {
    const pricing = getModelPricing("gpt-image-2");
    expect(pricing).toEqual({
      inputPerMillionUsd: 5,
      outputPerMillionUsd: 30,
    });
    // 1M input + 1M output → $5 + $30
    expect(estimateUsageCostUsd("gpt-image-2", 1_000_000, 1_000_000)).toBe(35);
  });

  test("uses saved pricing for openrouter custom models", () => {
    const cost = estimateUsageCostUsd(
      "anthropic/claude-sonnet-4-6",
      1_000_000,
      1_000_000,
      {
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
      }
    );

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
      })
    ).toBeNull();
    expect(
      estimateUsageCostUsd("anthropic/claude-sonnet-4-6", 1000, 500, {
        provider: "openrouter",
        providerInstance: {
          ...openRouterInstance,
          customModels: [{ id: "anthropic/claude-sonnet-4-6" }],
        },
      })
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

  test("uses saved pricing for fireworks custom models", () => {
    const cost = estimateUsageCostUsd(
      "accounts/fireworks/models/kimi-k2p6",
      1_000_000,
      1_000_000,
      {
        provider: "fireworks",
        providerInstance: {
          ...fireworksInstance,
          customModels: [
            {
              id: "accounts/fireworks/models/kimi-k2p6",
              inputPerMillionUsd: 0.5,
              outputPerMillionUsd: 2,
            },
          ],
        },
      }
    );

    expect(cost).toBeCloseTo(2.5, 5);
  });

  test("uses saved pricing for moonshot discovered models", () => {
    const cost = estimateUsageCostUsd("kimi-k2.5", 1_000_000, 1_000_000, {
      provider: "moonshot",
      providerInstance: {
        ...moonshotInstance,
        customModels: [
          {
            id: "kimi-k2.5",
            inputPerMillionUsd: 0.6,
            outputPerMillionUsd: 2.5,
          },
        ],
      },
    });

    expect(cost).toBeCloseTo(3.1, 5);
  });

  test("does not estimate discovery-provider models without saved pricing", () => {
    // Discovery catalogs are fetched at runtime, so there is no bundled entry
    // to price against: report unknown instead of DEFAULT_PRICING.
    expect(
      getModelPricing("kimi-k2.5", {
        provider: "moonshot",
        providerInstance: {
          ...moonshotInstance,
          customModels: [{ id: "kimi-k2.5" }],
        },
      })
    ).toBeNull();
    expect(getModelPricing("MiniMax-M3", { provider: "minimax" })).toBeNull();
    expect(getModelPricing("glm-5.2", { provider: "zhipu_cn" })).toBeNull();
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
      estimateUsageCostUsd("llama3.2", 1000, 500, {
        provider: "openai_compatible",
        providerInstance: {
          ...compatibleInstance,
          customModels: [{ id: "llama3.2" }],
        },
      })
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
      })
    ).toBe(true);
  });
});

describe("getExplicitModelPricing", () => {
  test("returns null where getModelPricing falls back", () => {
    expect(getExplicitModelPricing("vendor/custom-model")).toBeNull();
    expect(getModelPricing("vendor/custom-model")).not.toBeNull();
  });

  test("returns the catalog rates for a known model", () => {
    expect(getExplicitModelPricing("claude-sonnet-4-6")).toEqual({
      inputPerMillionUsd: 3,
      outputPerMillionUsd: 15,
    });
  });

  test("returns the Images rates for gpt-image-2", () => {
    expect(getExplicitModelPricing("gpt-image-2")).toEqual({
      inputPerMillionUsd: 5,
      outputPerMillionUsd: 30,
    });
  });

  test("returns what the user typed for a custom model", () => {
    expect(
      getExplicitModelPricing("llama3.2", {
        provider: "openai_compatible",
        providerInstance: {
          ...compatibleInstance,
          customModels: [
            { id: "llama3.2", inputPerMillionUsd: 2, outputPerMillionUsd: 4 },
          ],
        },
      })
    ).toEqual({ inputPerMillionUsd: 2, outputPerMillionUsd: 4 });
  });
});
