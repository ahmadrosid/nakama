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
    expect(resolveModel("openai", "gpt-4o-mini")).toBe("gpt-4o-mini");
  });

  test("resolves catalog models for Gemini", () => {
    expect(resolveModel("gemini", "gemini-2.5-pro")).toBe("gemini-2.5-pro");
    expect(getDefaultModel("gemini")).toBe("gemini-2.5-flash");
  });

  test("resolves custom shortlist models for OpenAI", () => {
    const customModels = [{ id: "gpt-4o-mini", default: true }];
    expect(resolveModel("openai", "gpt-4o-mini", customModels)).toBe("gpt-4o-mini");
    expect(resolveModel("openai", "gpt-5.4", customModels)).toBe("gpt-4o-mini");
    expect(resolveModel("openai", undefined, customModels)).toBe("gpt-4o-mini");
  });

  test("passes through non-catalog models for native providers", () => {
    expect(resolveModel("anthropic", "claude-haiku-4-5-20251001")).toBe(
      "claude-haiku-4-5-20251001",
    );
    expect(resolveModel("openai", "gpt-4o-2025-08")).toBe("gpt-4o-2025-08");
    expect(resolveModel("gemini", "gemini-3.0-ultra")).toBe("gemini-3.0-ultra");
  });

  test("resolves compatible models from custom list", () => {
    const customModels = [{ id: "llama3.2", default: true }];
    expect(resolveModel("openai_compatible", "llama3.2", customModels)).toBe(
      "llama3.2",
    );
    expect(resolveModel("openai_compatible", undefined, customModels)).toBe(
      "llama3.2",
    );
  });

  test("resolves catalog models for OpenCode Go", () => {
    expect(resolveModel("opencode_go", "opencode-go/kimi-k2.7-code")).toBe(
      "opencode-go/kimi-k2.7-code",
    );
    expect(getDefaultModel("opencode_go")).toBe("opencode-go/kimi-k2.7-code");
  });

  test("passes through unknown OpenCode Go model ids", () => {
    expect(resolveModel("opencode_go", "opencode-go/future-model")).toBe(
      "opencode-go/future-model",
    );
  });

  test("resolves catalog models for DeepSeek", () => {
    expect(resolveModel("deepseek", "deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(getDefaultModel("deepseek")).toBe("deepseek-v4-flash");
  });

  test("resolves catalog models for Cerebras", () => {
    expect(resolveModel("cerebras", "gpt-oss-120b")).toBe("gpt-oss-120b");
    expect(getDefaultModel("cerebras")).toBe("gpt-oss-120b");
  });

  test("uses cerebras custom model shortlist when provided", () => {
    const customModels = [{ id: "zai-glm-4.7", name: "GLM 4.7", default: true }];
    expect(resolveModel("cerebras", "zai-glm-4.7", customModels)).toBe("zai-glm-4.7");
    expect(resolveModel("cerebras", "unknown-model", customModels)).toBe("zai-glm-4.7");
  });
});
