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
    expect(resolveModel("openai", "gpt-5.6-luna")).toBe("gpt-5.6-luna");
    expect(resolveModel("openai", "gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(getModelById("gpt-5.6-luna")?.provider).toBe("openai");
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

  test("resolves catalog models for Together AI", () => {
    expect(resolveModel("together", "openai/gpt-oss-120b")).toBe(
      "openai/gpt-oss-120b"
    );
    expect(
      resolveModel("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo")
    ).toBe("meta-llama/Llama-3.3-70B-Instruct-Turbo");
    expect(getDefaultModel("together")).toBe("openai/gpt-oss-120b");
    expect(getModelById("Qwen/Qwen3.5-9B")?.supportsVision).toBe(true);
    expect(getModelById("Qwen/Qwen3.5-9B")?.supportsThinking).toBe(true);
    expect(getModelById("MiniMaxAI/MiniMax-M3")?.supportsVision).toBe(true);
    expect(getModelById("MiniMaxAI/MiniMax-M3")?.supportsThinking).toBe(true);
    expect(getModelById("MiniMaxAI/MiniMax-M3")?.contextWindow).toBe(1_048_576);
    expect(getModelById("openai/gpt-oss-120b")?.supportsThinking).toBe(true);
  });

  test("uses together custom model shortlist when provided", () => {
    const customModels = [
      { default: true, id: "Qwen/Qwen3.5-9B", name: "Qwen3.5 9B" },
    ];
    expect(resolveModel("together", "Qwen/Qwen3.5-9B", customModels)).toBe(
      "Qwen/Qwen3.5-9B"
    );
    expect(resolveModel("together", "unknown-model", customModels)).toBe(
      "Qwen/Qwen3.5-9B"
    );
  });

  test("resolves catalog models for Vercel AI Gateway", () => {
    expect(resolveModel("vercel_ai_gateway", "openai/gpt-4o-mini")).toBe(
      "openai/gpt-4o-mini"
    );
    expect(
      resolveModel("vercel_ai_gateway", "anthropic/claude-sonnet-4.5")
    ).toBe("anthropic/claude-sonnet-4.5");
    expect(getDefaultModel("vercel_ai_gateway")).toBe("openai/gpt-4o-mini");
    expect(getModelById("openai/gpt-4o-mini")?.supportsVision).toBe(true);
    expect(getModelById("openai/gpt-5")?.supportsThinking).toBe(true);
    expect(getModelById("meta/llama-3.3-70b")?.supportsVision).toBe(false);
    expect(getModelById("deepseek/deepseek-v4-flash")?.supportsThinking).toBe(
      true
    );
  });

  test("uses vercel_ai_gateway custom model shortlist when provided", () => {
    const customModels = [{ default: true, id: "openai/gpt-5", name: "GPT-5" }];
    expect(
      resolveModel("vercel_ai_gateway", "openai/gpt-5", customModels)
    ).toBe("openai/gpt-5");
    expect(
      resolveModel("vercel_ai_gateway", "unknown-model", customModels)
    ).toBe("openai/gpt-5");
  });

  test("resolves catalog models for Mistral", () => {
    expect(resolveModel("mistral", "mistral-large-2512")).toBe(
      "mistral-large-2512"
    );
    expect(getDefaultModel("mistral")).toBe("mistral-small-2603");
    expect(getModelById("mistral-small-2603")?.supportsThinking).toBe(true);
    expect(getModelById("mistral-small-2603")?.supportsVision).toBe(true);
    expect(getModelById("ministral-3b-2512")?.supportsVision).toBe(true);
  });

  test("uses mistral custom model shortlist when provided", () => {
    const customModels = [
      { default: true, id: "mistral-small-2603", name: "Mistral Small 4" },
    ];
    expect(resolveModel("mistral", "mistral-small-2603", customModels)).toBe(
      "mistral-small-2603"
    );
    expect(resolveModel("mistral", "unknown-model", customModels)).toBe(
      "mistral-small-2603"
    );
  });

  test("resolves the current Perplexity Sonar catalog", () => {
    expect(getDefaultModel("perplexity")).toBe("sonar");
    expect(resolveModel("perplexity", "sonar-pro")).toBe("sonar-pro");
    expect(getModelById("sonar")?.contextWindow).toBe(128_000);
    expect(getModelById("sonar")?.inputPerMillionUsd).toBe(1);
    expect(getModelById("sonar")?.outputPerMillionUsd).toBe(1);
    expect(getModelById("sonar-pro")?.contextWindow).toBe(200_000);
    expect(getModelById("sonar-pro")?.supportsVision).toBe(true);
    expect(getModelById("sonar-reasoning-pro")?.supportsThinking).toBe(true);
    expect(getModelById("sonar-deep-research")?.supportsVision).toBe(false);
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

  test("resolves Zhipu GLM models from discovered custom models", () => {
    const customModels = [
      { default: true, id: "glm-5.2" },
      { id: "glm-5.1" },
      { id: "glm-4v" },
    ];

    expect(resolveModel("zhipu", "glm-5.1", customModels)).toBe("glm-5.1");
    expect(getDefaultModel("zhipu", customModels)).toBe("glm-5.2");
    expect(getDefaultModel("zhipu_cn", customModels)).toBe("glm-5.2");
  });

  test("falls back to instance default for unknown Zhipu ids", () => {
    const customModels = [{ default: true, id: "glm-5.2" }];
    expect(resolveModel("zhipu_cn", "not-a-real-model", customModels)).toBe(
      "glm-5.2"
    );
  });

  test("resolves Moonshot models from discovered custom models", () => {
    const customModels = [
      { default: true, id: "kimi-k2.5-turbo-preview" },
      { id: "kimi-k2.5" },
      { id: "moonshot-v1-128k" },
    ];

    expect(resolveModel("moonshot", "kimi-k2.5", customModels)).toBe(
      "kimi-k2.5"
    );
    expect(getDefaultModel("moonshot", customModels)).toBe(
      "kimi-k2.5-turbo-preview"
    );
    expect(getDefaultModel("moonshot_cn", customModels)).toBe(
      "kimi-k2.5-turbo-preview"
    );
  });

  test("keeps Moonshot region catalogs independent", () => {
    // Both platforms expose overlapping ids, so an id discovered on one
    // instance still resolves against that instance's own list.
    const cnModels = [{ default: true, id: "moonshot-v1-8k-vision-preview" }];

    expect(
      resolveModel("moonshot_cn", "moonshot-v1-8k-vision-preview", cnModels)
    ).toBe("moonshot-v1-8k-vision-preview");
    expect(resolveModel("moonshot", "not-a-real-model", cnModels)).toBe(
      "moonshot-v1-8k-vision-preview"
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

  test("keeps Zhipu models opt-in only (GLM-4V flags via discovery)", () => {
    expect(modelSupportsVision("glm-5.2", "zhipu")).toBe(false);

    expect(
      modelSupportsVision("glm-4v", "zhipu_cn", [
        { id: "glm-4v", supportsVision: true },
      ])
    ).toBe(true);
  });

  test("keeps Moonshot models opt-in only (discovered lists)", () => {
    // Intl K2.x is text-only; the CN platform exposes vision variants, so
    // vision comes from discovered metadata, never from the id.
    expect(modelSupportsVision("kimi-k2.5", "moonshot")).toBe(false);
    expect(
      modelSupportsVision("moonshot-v1-8k-vision-preview", "moonshot_cn", [
        { id: "moonshot-v1-8k-vision-preview" },
      ])
    ).toBe(false);

    expect(
      modelSupportsVision("moonshot-v1-8k-vision-preview", "moonshot_cn", [
        { id: "moonshot-v1-8k-vision-preview", supportsVision: true },
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

  test("reads Together AI vision flags from the curated catalog", () => {
    expect(modelSupportsVision("openai/gpt-oss-120b", "together")).toBe(false);
    expect(modelSupportsVision("Qwen/Qwen3.5-9B", "together")).toBe(true);
    expect(modelSupportsVision("MiniMaxAI/MiniMax-M3", "together")).toBe(true);
  });

  test("reads Vercel AI Gateway vision flags from the curated catalog", () => {
    expect(modelSupportsVision("openai/gpt-4o-mini", "vercel_ai_gateway")).toBe(
      true
    );
    expect(modelSupportsVision("meta/llama-3.3-70b", "vercel_ai_gateway")).toBe(
      false
    );
  });

  test("reads Mistral vision flags from the curated catalog", () => {
    expect(modelSupportsVision("mistral-small-2603", "mistral")).toBe(true);
    expect(modelSupportsVision("mistral-large-2512", "mistral")).toBe(true);
    expect(modelSupportsVision("ministral-14b-2512", "mistral")).toBe(true);
  });

  test("reads Perplexity vision flags from the curated catalog", () => {
    expect(modelSupportsVision("sonar", "perplexity")).toBe(true);
    expect(modelSupportsVision("sonar-pro", "perplexity")).toBe(true);
    expect(modelSupportsVision("sonar-deep-research", "perplexity")).toBe(
      false
    );
  });
});
