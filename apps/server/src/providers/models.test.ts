import { describe, expect, test } from "bun:test";
import {
  getDefaultModel,
  isOpenRouterModelSlug,
  resolveModel,
} from "./models";

describe("isOpenRouterModelSlug", () => {
  test("accepts vendor/model slugs", () => {
    expect(isOpenRouterModelSlug("anthropic/claude-sonnet-4-6")).toBe(true);
  });

  test("rejects bare model ids", () => {
    expect(isOpenRouterModelSlug("gpt-5.4")).toBe(false);
  });
});

describe("resolveModel", () => {
  test("passes through custom OpenRouter slugs", () => {
    expect(resolveModel("openrouter", "google/gemini-2.5-pro-preview")).toBe(
      "google/gemini-2.5-pro-preview",
    );
  });

  test("falls back to default for invalid OpenRouter slugs", () => {
    expect(resolveModel("openrouter", "not-a-slug")).toBe(getDefaultModel("openrouter"));
  });

  test("resolves catalog models for OpenAI", () => {
    expect(resolveModel("openai", "gpt-5.4")).toBe("gpt-5.4");
  });

  test("resolves catalog models for Gemini", () => {
    expect(resolveModel("gemini", "gemini-2.5-pro")).toBe("gemini-2.5-pro");
    expect(getDefaultModel("gemini")).toBe("gemini-2.5-flash");
  });
});
