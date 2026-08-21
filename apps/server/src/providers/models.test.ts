import { describe, expect, test } from "bun:test";
import {
  getDefaultModel,
  getModelById,
  isOpenRouterModelSlug,
  modelSupportsVision,
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
      "google/gemini-2.5-pro-preview"
    );
  });

  test("falls back to default for invalid OpenRouter slugs", () => {
    expect(resolveModel("openrouter", "not-a-slug")).toBe(
      getDefaultModel("openrouter")
    );
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
    const customModels = [{ default: true, id: "gpt-4o-mini" }];
    expect(resolveModel("openai", "gpt-4o-mini", customModels)).toBe(
      "gpt-4o-mini"
    );
    expect(resolveModel("openai", "gpt-5.4", customModels)).toBe("gpt-4o-mini");
    expect(resolveModel("openai", undefined, customModels)).toBe("gpt-4o-mini");
  });

  test("passes through non-catalog models for native providers", () => {
    expect(resolveModel("anthropic", "claude-haiku-4-5-20251001")).toBe(
      "claude-haiku-4-5-20251001"
    );
    expect(resolveModel("openai", "gpt-4o-2025-08")).toBe("gpt-4o-2025-08");
    expect(resolveModel("gemini", "gemini-3.0-ultra")).toBe("gemini-3.0-ultra");
  });

  test("resolves compatible models from custom list", () => {
    const customModels = [{ default: true, id: "llama3.2" }];
    expect(resolveModel("openai_compatible", "llama3.2", customModels)).toBe(
      "llama3.2"
    );
    expect(resolveModel("openai_compatible", undefined, customModels)).toBe(
      "llama3.2"
    );
  });

  test("resolves catalog models for OpenCode Go", () => {
    expect(resolveModel("opencode_go", "opencode-go/kimi-k2.7-code")).toBe(
      "opencode-go/kimi-k2.7-code"
    );
    expect(getDefaultModel("opencode_go")).toBe("opencode-go/kimi-k2.7-code");
  });

  test("passes through unknown OpenCode Go model ids", () => {
    expect(resolveModel("opencode_go", "opencode-go/future-model")).toBe(
      "opencode-go/future-model"
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
    const customModels = [
      { default: true, id: "zai-glm-4.7", name: "GLM 4.7" },
    ];
    expect(resolveModel("cerebras", "zai-glm-4.7", customModels)).toBe(
      "zai-glm-4.7"
    );
    expect(resolveModel("cerebras", "unknown-model", customModels)).toBe(
      "zai-glm-4.7"
    );
  });

  test("resolves catalog models for Fireworks", () => {
    expect(
      resolveModel("fireworks", "accounts/fireworks/models/kimi-k2p6")
    ).toBe("accounts/fireworks/models/kimi-k2p6");
    expect(getDefaultModel("fireworks")).toBe(
      "accounts/fireworks/models/kimi-k2p6"
    );
  });

  test("resolves official Cloudflare 8B catalog ids", () => {
    expect(resolveModel("cloudflare", "@cf/meta/llama-3.1-8b-instruct")).toBe(
      "@cf/meta/llama-3.1-8b-instruct"
    );
    expect(
      resolveModel("cloudflare", "@cf/meta/llama-3.1-8b-instruct-fast")
    ).toBe("@cf/meta/llama-3.1-8b-instruct-fast");
    expect(
      getModelById("@cf/meta/infire-llama-3.1-8b-instruct")
    ).toBeUndefined();
  });

  test("uses fireworks custom model shortlist when provided", () => {
    const customModels = [
      {
        default: true,
        id: "accounts/fireworks/models/glm-5p2",
        name: "GLM 5.2",
      },
    ];
    expect(
      resolveModel(
        "fireworks",
        "accounts/fireworks/models/glm-5p2",
        customModels
      )
    ).toBe("accounts/fireworks/models/glm-5p2");
    expect(resolveModel("fireworks", "unknown-model", customModels)).toBe(
      "accounts/fireworks/models/glm-5p2"
    );
  });

  test("resolves MiniMax models from discovered custom models", () => {
    const customModels = [
      { default: true, id: "MiniMax-M3" },
      { id: "MiniMax-M2.7" },
      { id: "MiniMax-M2.5" },
    ];

    expect(resolveModel("minimax", "MiniMax-M2.7", customModels)).toBe(
      "MiniMax-M2.7"
    );
    expect(getDefaultModel("minimax", customModels)).toBe("MiniMax-M3");
    expect(getDefaultModel("minimax_cn", customModels)).toBe("MiniMax-M3");
  });

  test("falls back to instance default for unknown MiniMax ids", () => {
    const customModels = [{ default: true, id: "MiniMax-M3" }];
    expect(resolveModel("minimax_cn", "not-a-real-model", customModels)).toBe(
      "MiniMax-M3"
    );
  });
});

describe("modelSupportsVision", () => {
  test("keeps MiniMax models opt-in only (discovered lists)", () => {
    expect(modelSupportsVision("MiniMax-M3", "minimax")).toBe(false);

    expect(
      modelSupportsVision("MiniMax-VL", "minimax_cn", [
        { id: "MiniMax-VL", supportsVision: true },
      ])
    ).toBe(true);
  });

  test("treats openai-compatible models as opt-in only", () => {
    expect(
      modelSupportsVision("qwen-vl", "openai_compatible", [{ id: "qwen-vl" }])
    ).toBe(false);

    expect(
      modelSupportsVision("qwen-vl", "openai_compatible", [
        { id: "qwen-vl", supportsVision: true },
      ])
    ).toBe(true);
  });

  test("keeps OpenCode Go models opt-in only", () => {
    expect(
      modelSupportsVision("opencode-go/kimi-k2.7-code", "opencode_go")
    ).toBe(false);
  });
});
