import { describe, expect, test } from "bun:test";
import {
  isOpenRouterModelDeprecated,
  isOpenRouterModelFree,
  normalizeOpenRouterModels,
  openRouterPricingPerMillion,
} from "./openrouter-models";

const fixture = {
  data: [
    {
      architecture: { input_modalities: ["text"] },
      context_length: 1_000_000,
      description: "Free variant",
      expiration_date: null,
      id: "nvidia/nemotron-3-ultra-550b-a55b:free",
      name: "NVIDIA: Nemotron 3 Ultra (free)",
      pricing: { completion: "0", prompt: "0" },
      supported_parameters: ["tools", "reasoning"],
    },
    {
      architecture: { input_modalities: ["text", "image"] },
      context_length: 1_000_000,
      description: "Paid variant",
      expiration_date: null,
      id: "nvidia/nemotron-3-ultra-550b-a55b",
      name: "NVIDIA: Nemotron 3 Ultra",
      pricing: { completion: "0.0000025", prompt: "0.0000005" },
      supported_parameters: ["tools"],
    },
    {
      architecture: { input_modalities: ["text"] },
      context_length: 128_000,
      description: "Free without :free suffix",
      expiration_date: "2027-01-01",
      id: "openrouter/owl-alpha",
      name: "Owl Alpha",
      pricing: { completion: "0", prompt: "0" },
      supported_parameters: [],
    },
    {
      architecture: { input_modalities: ["text", "image", "video"] },
      context_length: 1_048_576,
      description: "Stealth preview",
      expiration_date: "2098-12-31",
      id: "stealth/ox-alpha",
      name: "Ox Alpha",
      pricing: { completion: "0", prompt: "0" },
      supported_parameters: ["tools", "reasoning"],
    },
  ],
};

describe("isOpenRouterModelFree", () => {
  test("returns true when prompt and completion are zero", () => {
    expect(isOpenRouterModelFree({ completion: "0", prompt: "0" })).toBe(true);
  });

  test("returns false when completion is non-zero", () => {
    expect(
      isOpenRouterModelFree({ completion: "0.0000025", prompt: "0" })
    ).toBe(false);
  });
});

describe("openRouterPricingPerMillion", () => {
  test("converts per-token API pricing to dollars per million tokens", () => {
    expect(
      openRouterPricingPerMillion({
        completion: "0.0000025",
        prompt: "0.0000005",
      })
    ).toEqual({
      inputPerMillionUsd: 0.5,
      outputPerMillionUsd: 2.5,
    });
  });

  test("returns zero rates for free models", () => {
    expect(
      openRouterPricingPerMillion({
        completion: "0",
        prompt: "0",
      })
    ).toEqual({
      inputPerMillionUsd: 0,
      outputPerMillionUsd: 0,
    });
  });
});

describe("normalizeOpenRouterModels", () => {
  test("marks free models and sorts free first", () => {
    const rows = normalizeOpenRouterModels(fixture);

    expect(rows).toHaveLength(4);
    expect(rows[0]?.isFree).toBe(true);
    expect(rows[1]?.isFree).toBe(true);
    expect(rows[2]?.isFree).toBe(true);
    expect(rows[3]?.isFree).toBe(false);
    expect(rows.find((row) => row.id.endsWith(":free"))?.isFree).toBe(true);
  });

  test("detects vision and capability chips", () => {
    const rows = normalizeOpenRouterModels(fixture);
    const paid = rows.find(
      (row) => row.id === "nvidia/nemotron-3-ultra-550b-a55b"
    );

    expect(paid?.vision).toBe(true);
    expect(paid?.tools).toBe(true);
    expect(paid?.reasoning).toBe(false);
    expect(paid?.inputPerMillionUsd).toBe(0.5);
    expect(paid?.outputPerMillionUsd).toBe(2.5);
  });

  test("marks deprecated when expiration_date is a real sunset", () => {
    const rows = normalizeOpenRouterModels(fixture);
    const owl = rows.find((row) => row.id === "openrouter/owl-alpha");

    expect(owl?.deprecated).toBe(true);
  });

  test("does not treat OpenRouter sentinel expiration dates as deprecated", () => {
    const rows = normalizeOpenRouterModels(fixture);
    const oxAlpha = rows.find((row) => row.id === "stealth/ox-alpha");

    expect(oxAlpha?.deprecated).toBe(false);
  });
});

describe("isOpenRouterModelDeprecated", () => {
  test("returns false for missing expiration", () => {
    expect(isOpenRouterModelDeprecated(null)).toBe(false);
    expect(isOpenRouterModelDeprecated(undefined)).toBe(false);
  });

  test("returns true for a scheduled sunset", () => {
    expect(isOpenRouterModelDeprecated("2026-08-24")).toBe(true);
  });

  test("returns false for far-future sentinel dates", () => {
    expect(isOpenRouterModelDeprecated("2098-12-31")).toBe(false);
  });
});
