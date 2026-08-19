import { describe, expect, test } from "bun:test";
import { CLOUDFLARE_MODELS } from "./catalog";

describe("CLOUDFLARE_MODELS", () => {
  test("has at least one default model", () => {
    const defaults = CLOUDFLARE_MODELS.filter((m) => m.default);
    expect(defaults.length).toBe(1);
  });

  test("all models have required fields", () => {
    for (const model of CLOUDFLARE_MODELS) {
      expect(model.id).toBeTruthy();
      expect(model.name).toBeTruthy();
      expect(model.provider).toBe("cloudflare");
      expect(model.contextWindow).toBeGreaterThan(0);
      expect(model.maxOutputTokens).toBeGreaterThan(0);
    }
  });

  test("all model IDs start with @cf/", () => {
    for (const model of CLOUDFLARE_MODELS) {
      expect(model.id).toMatch(/^@cf\//);
    }
  });

  test("default model is llama-3.1-8b-instruct", () => {
    const defaultModel = CLOUDFLARE_MODELS.find((m) => m.default);
    expect(defaultModel?.id).toBe("@cf/meta/llama-3.1-8b-instruct");
  });
});
