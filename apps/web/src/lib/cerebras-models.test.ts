import { describe, expect, test } from "bun:test";
import {
  CEREBRAS_FALLBACK_MODELS,
  cerebrasPricingPerMillion,
  normalizeCerebrasModel,
  normalizeCerebrasModels,
} from "./cerebras-models";

const fixture = {
  data: [
    {
      capabilities: {
        reasoning: true,
        tools: true,
        vision: false,
      },
      deprecated: false,
      description: "Reasoning model",
      id: "gpt-oss-120b",
      limits: { max_context_length: 131_072 },
      name: "OpenAI GPT OSS",
      preview: false,
      pricing: { completion: "0.00000075", prompt: "0.00000035" },
    },
    {
      capabilities: {
        function_calling: true,
        reasoning: true,
        vision: true,
      },
      deprecated: false,
      description: "Vision model",
      id: "gemma-4-31b",
      limits: { max_context_length: 131_072 },
      name: "Gemma 4 31B",
      preview: false,
      pricing: { completion: "0.00000149", prompt: "0.00000099" },
    },
  ],
};

describe("cerebrasPricingPerMillion", () => {
  test("converts per-token API pricing to dollars per million tokens", () => {
    expect(
      cerebrasPricingPerMillion({
        completion: "0.00000075",
        prompt: "0.00000035",
      })
    ).toEqual({
      inputPerMillionUsd: 0.35,
      outputPerMillionUsd: 0.75,
    });
  });
});

describe("normalizeCerebrasModels", () => {
  test("covers representative public catalog ids", () => {
    const rows = normalizeCerebrasModels(fixture);

    expect(rows.map((row) => row.id)).toEqual(["gemma-4-31b", "gpt-oss-120b"]);
  });

  test("maps capabilities.reasoning and vision", () => {
    const rows = normalizeCerebrasModels(fixture);
    const gpt = rows.find((row) => row.id === "gpt-oss-120b");
    const gemma = rows.find((row) => row.id === "gemma-4-31b");

    expect(gpt?.reasoning).toBe(true);
    expect(gpt?.vision).toBe(false);
    expect(gemma?.reasoning).toBe(true);
    expect(gemma?.vision).toBe(true);
  });

  test("handles missing capabilities safely", () => {
    const row = normalizeCerebrasModel({
      id: "unknown-model",
      name: "Unknown",
    });

    expect(row.reasoning).toBe(false);
    expect(row.vision).toBe(false);
    expect(row.tools).toBe(false);
  });
});

describe("CEREBRAS_FALLBACK_MODELS", () => {
  test("includes curated fallback ids", () => {
    expect(CEREBRAS_FALLBACK_MODELS.map((row) => row.id)).toEqual([
      "gpt-oss-120b",
      "gemma-4-31b",
      "zai-glm-4.7",
    ]);
  });
});
