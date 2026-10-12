import { describe, expect, test } from "bun:test";
import {
  getDefaultModel,
  getModelById,
  getModelsForProvider,
  isOpenRouterModelSlug,
  modelSupportsVision,
  resolveModel,
  resolveModelLimits,
} from "./models";
import { estimateUsageCostUsd } from "./pricing";

describe("isOpenRouterModelSlug", () => {
  test("accepts vendor/model slugs", () => {
    expect(isOpenRouterModelSlug("anthropic/claude-sonnet-4-6")).toBe(true);
  });

  test("accepts latest-model aliases", () => {
    expect(isOpenRouterModelSlug("~google/gemini-flash-latest")).toBe(true);
  });

  test("rejects bare model ids", () => {
    expect(isOpenRouterModelSlug("gpt-5.4")).toBe(false);
  });
});

describe("resolveModel", () => {
  test.each([
    ["xiaomi", "mimo-v2.5-pro", "mimo-v2.5-pro"],
    ["xiaomi", "mimo-v2.5", "mimo-v2.5-pro"],
    ["openai", "gpt-5.4", "gpt-5.4"],
    ["openai", "gpt-5.6-luna", "gpt-5.4"],
    ["openai", "gpt-4o-mini", "gpt-5.4"],
    ["gemini", "gemini-2.5-pro", "gemini-2.5-flash"],
    ["opencode_go", "opencode-go/kimi-k2.7-code", "opencode-go/kimi-k2.7-code"],
    ["cerebras", "gpt-oss-120b", "gpt-oss-120b"],
    [
      "fireworks",
      "accounts/fireworks/models/kimi-k2p6",
      "accounts/fireworks/models/kimi-k2p6",
    ],
  ] as const)("%s resolves catalog id %s", (provider, id, defaultId) => {
    expect(resolveModel(provider, id)).toBe(id);
    expect(getDefaultModel(provider)).toBe(defaultId);
  });

  test.each([
    ["xiaomi", "mimo-v2.5"],
    ["openai", "gpt-4o-mini"],
    ["together", "Qwen/Qwen3.5-9B"],
    ["vercel_ai_gateway", "openai/gpt-5"],
    ["mistral", "mistral-small-2603"],
    ["qwen", "qwen-flash"],
    ["qwen_cn", "qwen-flash"],
    ["doubao", "doubao-seed-2-1-turbo-260628"],
    ["cerebras", "zai-glm-4.7"],
    ["fireworks", "accounts/fireworks/models/glm-5p2"],
  ] as const)("%s honors its custom shortlist", (provider, id) => {
    const customModels = [{ default: true, id }];
    expect(resolveModel(provider, id, customModels)).toBe(id);
    expect(resolveModel(provider, "unknown-model", customModels)).toBe(id);
    expect(resolveModel(provider, undefined, customModels)).toBe(id);
  });

  test("defaults ChatGPT to Terra without changing OpenAI", () => {
    expect(resolveModel("chatgpt")).toBe("gpt-5.6-terra");
    expect(getDefaultModel("chatgpt", [])).toBe("gpt-5.6-terra");
    expect(getDefaultModel("openai")).toBe("gpt-5.4");
    expect(getModelsForProvider("chatgpt").map((model) => model.id)).toEqual([
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "gpt-5.6-luna",
      "gpt-6.1-sol",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-6-astra",
      "gpt-5.5",
    ]);

    for (const id of ["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna"]) {
      expect(
        getModelsForProvider("chatgpt").find((model) => model.id === id)
      ).toMatchObject({
        contextWindow: 272_000,
        inputPerMillionUsd: 0,
        outputPerMillionUsd: 0,
      });
      expect(
        getModelsForProvider("chatgpt").find((model) => model.id === id)
          ?.maxOutputTokens
      ).toBeUndefined();
    }
  });

  test("honors ChatGPT instance defaults without replacing explicit selections", () => {
    const customModels = [
      { id: "gpt-5.6-sol" },
      { default: true, id: "gpt-5.6-luna" },
    ];

    expect(resolveModel("chatgpt", undefined, customModels)).toBe(
      "gpt-5.6-luna"
    );
    expect(getDefaultModel("chatgpt", [{ id: "account-model" }])).toBe(
      "account-model"
    );
    expect(resolveModel("chatgpt", " gpt-5.4 ", customModels)).toBe("gpt-5.4");
  });

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

  test("exposes OpenAI API limits and base text prices without changing selections", () => {
    // Official model pages: https://developers.openai.com/api/docs/models/<id>
    // Cost expectations use 100k input + 20k output, below long-context tiers.
    for (const [id, context, output, inputPrice, outputPrice, cost] of [
      ["gpt-6.1-sol", 1_050_000, 128_000, 2, 10, 0.4],
      ["gpt-6-sol", 1_050_000, 128_000, 2, 10, 0.4],
      ["gpt-6-luna", 1_050_000, 128_000, 0.1, 0.5, 0.02],
      ["gpt-6-astra", 1_050_000, 128_000, 10, 50, 2],
      ["gpt-5.6-luna", 1_050_000, 128_000, 0.2, 1.2, 0.044],
      ["gpt-5.5", 1_050_000, 128_000, 5, 30, 1.1],
      ["gpt-5.4", 1_050_000, 128_000, 2.5, 15, 0.55],
      ["gpt-5.3-codex", 400_000, 128_000, 1.75, 14, 0.455],
      ["gpt-4o-mini", 128_000, 16_384, 0.15, 0.6, 0.027],
    ] as const) {
      expect(
        getModelsForProvider("openai").find((m) => m.id === id)
      ).toMatchObject({
        inputPerMillionUsd: inputPrice,
        outputPerMillionUsd: outputPrice,
        supportsVision: true,
      });
      expect(resolveModelLimits("openai", id)).toEqual({
        contextWindow: context,
        maxOutputTokens: output,
      });
      expect(estimateUsageCostUsd(id, 100_000, 20_000)).toBeCloseTo(cost);
      expect(resolveModel("openai", id)).toBe(id);
    }

    expect(getDefaultModel("openai")).toBe("gpt-5.4");
  });

  test("exposes current Gemini limits and standard text prices without changing defaults", () => {
    for (const [id, input, output] of [
      ["gemini-2.5-flash", 0.3, 2.5],
      ["gemini-2.5-pro", 1.25, 10],
      ["gemini-3.8-flash", 0.75, 3.75],
      ["gemini-3.1-pro-preview", 2, 12],
    ] as const) {
      expect(getModelById(id)).toMatchObject({
        contextWindow: 1_048_576,
        inputPerMillionUsd: input,
        maxOutputTokens: 65_536,
        outputPerMillionUsd: output,
        provider: "gemini",
      });
    }

    expect(getModelById("gemini-3.8-flash")?.default).not.toBe(true);
  });

  test("exposes current Anthropic limits and prices while preserving selections", () => {
    for (const [id, contextWindow, maxOutputTokens, input, output] of [
      ["claude-sonnet-5", 1_000_000, 128_000, 2, 10],
      ["claude-sonnet-5-5", 1_000_000, 128_000, 2, 10],
      ["claude-opus-5", 1_000_000, 128_000, 5, 25],
      ["claude-opus-5-5", 1_000_000, 128_000, 4, 20],
      ["claude-haiku-4-5-20251001", 200_000, 64_000, 1, 5],
      ["claude-sonnet-4-6", 1_000_000, 128_000, 3, 15],
      ["claude-opus-4-6", 1_000_000, 128_000, 5, 25],
    ] as const) {
      expect(getModelById(id)).toMatchObject({
        contextWindow,
        inputPerMillionUsd: input,
        maxOutputTokens,
        outputPerMillionUsd: output,
        provider: "anthropic",
        supportsThinking: true,
        supportsVision: true,
      });
      expect(resolveModel("anthropic", id)).toBe(id);
    }

    expect(getDefaultModel("anthropic")).toBe("claude-sonnet-4-6");
    expect(
      resolveModel("anthropic", undefined, [
        { default: true, id: "claude-opus-4-6" },
      ])
    ).toBe("claude-opus-4-6");
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

  test("passes through unknown OpenCode Go model ids", () => {
    expect(resolveModel("opencode_go", "opencode-go/future-model")).toBe(
      "opencode-go/future-model"
    );
  });

  test("resolves catalog models for DeepSeek", () => {
    expect(resolveModel("deepseek", "deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(getDefaultModel("deepseek")).toBe("deepseek-flash");

    for (const id of [
      "deepseek-flash",
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
    ]) {
      expect(resolveModel("deepseek", id)).toBe(id);
      expect(getModelById(id)).toMatchObject({
        contextWindow: 1_000_000,
        default: id === "deepseek-flash",
        inputPerMillionUsd: 0.3,
        maxOutputTokens: 384_000,
        outputPerMillionUsd: 1.2,
        provider: "deepseek",
        supportsThinking: true,
        supportsVision: false,
      });
    }
  });

  test("keeps DeepSeek custom shortlist defaults and selections", () => {
    const customModels = [
      { default: true, id: "private-model" },
      { id: "deepseek-v4-flash-vision-exp", supportsVision: true },
    ];

    expect(getDefaultModel("deepseek", customModels)).toBe("private-model");
    expect(resolveModel("deepseek", "deepseek-flash", customModels)).toBe(
      "private-model"
    );
    expect(
      resolveModel("deepseek", "deepseek-v4-flash-vision-exp", customModels)
    ).toBe("deepseek-v4-flash-vision-exp");
    expect(
      modelSupportsVision(
        "deepseek-v4-flash-vision-exp",
        "deepseek",
        customModels
      )
    ).toBe(true);
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

  test("resolves catalog models for Mistral", () => {
    expect(resolveModel("mistral", "mistral-large-2512")).toBe(
      "mistral-large-2512"
    );
    expect(getDefaultModel("mistral")).toBe("mistral-small-2603");
    expect(getModelById("mistral-small-2603")?.supportsThinking).toBe(true);
    expect(getModelById("mistral-small-2603")?.supportsVision).toBe(true);
    expect(getModelById("ministral-3b-2512")?.supportsVision).toBe(true);
  });

  test("resolves catalog models for Qwen DashScope intl and CN", () => {
    expect(resolveModel("qwen", "qwen3.7-plus")).toBe("qwen3.7-plus");
    expect(resolveModel("qwen", "qwen3-vl-plus")).toBe("qwen3-vl-plus");
    expect(resolveModel("qwen_cn", "qwen-flash")).toBe("qwen-flash");
    expect(getDefaultModel("qwen")).toBe("qwen3.7-plus");
    expect(getDefaultModel("qwen_cn")).toBe("qwen3.7-plus");
    expect(getModelById("qwen3.7-plus")?.supportsThinking).toBe(true);
    expect(getModelById("qwen3.7-plus")?.contextWindow).toBe(1_000_000);
    expect(getModelById("qwen3.7-plus")?.supportsVision).toBe(true);
    expect(getModelById("qwen3-vl-plus")?.supportsVision).toBe(true);
    expect(getModelById("qwen3-vl-plus")?.supportsThinking).toBe(true);
    expect(getModelById("qwen-flash")?.supportsThinking).toBe(true);
    expect(getModelById("qwen-flash")?.inputPerMillionUsd).toBe(0.05);
  });

  test("resolves catalog models for Doubao", () => {
    expect(resolveModel("doubao", "doubao-seed-2-1-turbo-260628")).toBe(
      "doubao-seed-2-1-turbo-260628"
    );
    expect(resolveModel("doubao", "doubao-seed-1-8-251228")).toBe(
      "doubao-seed-1-8-251228"
    );
    expect(getDefaultModel("doubao")).toBe("doubao-seed-2-1-pro-260628");
    expect(getModelById("doubao-seed-2-1-pro-260628")?.supportsThinking).toBe(
      true
    );
    expect(getModelById("doubao-seed-2-1-pro-260628")?.supportsVision).toBe(
      true
    );
    expect(getModelById("doubao-seed-2-1-turbo-260628")?.supportsVision).toBe(
      true
    );
    expect(getModelById("doubao-seed-1-8-251228")?.supportsThinking).toBe(true);
    expect(getModelById("doubao-seed-1-8-251228")?.supportsVision).toBe(true);
    expect(getModelById("doubao-seed-2-1-pro-260628")?.contextWindow).toBe(
      256_000
    );
    expect(getModelById("doubao-seed-2-1-pro-260628")?.maxOutputTokens).toBe(
      256_000
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
  test.each([
    ["xiaomi", "mimo-v2.5-pro", false],
    ["xiaomi", "mimo-v2.5", true],
    ["together", "openai/gpt-oss-120b", false],
    ["together", "Qwen/Qwen3.5-9B", true],
    ["together", "MiniMaxAI/MiniMax-M3", true],
    ["vercel_ai_gateway", "openai/gpt-4o-mini", true],
    ["vercel_ai_gateway", "meta/llama-3.3-70b", false],
    ["mistral", "mistral-small-2603", true],
    ["mistral", "mistral-large-2512", true],
    ["mistral", "ministral-14b-2512", true],
    ["qwen", "qwen3.7-plus", true],
    ["qwen", "qwen-plus", false],
    ["qwen", "qwen3-vl-plus", true],
    ["qwen_cn", "qwen3-vl-plus", true],
    ["qwen_cn", "qwen-flash", false],
    ["doubao", "doubao-seed-2-1-pro-260628", true],
    ["doubao", "doubao-seed-2-1-turbo-260628", true],
    ["doubao", "doubao-seed-1-8-251228", true],
    ["perplexity", "sonar", true],
    ["perplexity", "sonar-pro", true],
    ["perplexity", "sonar-deep-research", false],
  ] as const)("%s %s vision support", (provider, id, expected) => {
    expect(modelSupportsVision(id, provider)).toBe(expected);
  });

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
});

describe("resolveModelLimits", () => {
  test("keeps ChatGPT limits separate from OpenAI for the same model id", () => {
    expect(resolveModelLimits("chatgpt", "gpt-5.5")).toEqual({
      contextWindow: 272_000,
      maxOutputTokens: 8192,
    });
    expect(resolveModelLimits("openai", "gpt-5.5")).toEqual({
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
    });
  });

  test("uses the instance entry for a model the catalog does not know", () => {
    expect(
      resolveModelLimits("openai_compatible", "my-org/llama-4-1m", [
        { contextWindow: 1_000_000, id: "my-org/llama-4-1m" },
      ])
    ).toEqual({ contextWindow: 1_000_000, maxOutputTokens: 8192 });
  });

  test("falls back to 128k when nothing declares a window", () => {
    expect(
      resolveModelLimits("openai_compatible", "my-org/llama-4-1m").contextWindow
    ).toBe(128_000);
    expect(
      resolveModelLimits("openai_compatible", "my-org/llama-4-1m", [
        { id: "my-org/llama-4-1m" },
      ]).contextWindow
    ).toBe(128_000);
  });

  test("prefers the instance entry over the catalog", () => {
    expect(
      resolveModelLimits("openai", "gpt-5.5", [
        {
          contextWindow: 32_000,
          id: "gpt-5.5",
          maxOutputTokens: 4096,
        },
      ])
    ).toEqual({ contextWindow: 32_000, maxOutputTokens: 4096 });
  });
});
