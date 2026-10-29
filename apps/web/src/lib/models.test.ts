import { describe, expect, test } from "bun:test";
import type { ProviderName } from "@nakama/core";
import { USER_PROVIDER_NAMES } from "@nakama/core/provider-resolution";
import {
  appendOpenRouterModelRow,
  buildCreateProviderRequest,
  effectiveProfileModelSelection,
  encodeModelSelection,
  filterVisionCapableProviderGroups,
  firstAvailableProviderOption,
  hasOpenCodeZenProvider,
  isOpenCodeZenBaseUrl,
  profileModelSelectionValue,
  resolveModelThinkingSupport,
  resolveModelVisionSupport,
  validateCustomModelsInput,
} from "./models";

describe("buildCreateProviderRequest", () => {
  test("keeps custom models only for providers that accept a shortlist", () => {
    const shortlistProviders: readonly ProviderName[] = [
      "openai_compatible",
      "netra",
      "openrouter",
      "xai_oauth",
      "chatgpt",
      "cerebras",
      "cloudflare",
      "fireworks",
      "ollama",
      "opencode_go",
    ];

    for (const provider of USER_PROVIDER_NAMES) {
      expect(buildCreateProviderRequest({ apiKey: "key", provider })).toEqual({
        apiKey: "key",
        type: provider,
      });

      const empty = buildCreateProviderRequest({
        apiKey: "key",
        customModels: [],
        provider,
      });

      const populated = buildCreateProviderRequest({
        apiKey: "key",
        customModels: [{ id: "private-model" }],
        provider,
      });

      if (provider === "openai_compatible" || provider === "netra") {
        expect(empty.customModels).toEqual([]);
      } else {
        expect(empty).not.toHaveProperty("customModels");
      }

      if (shortlistProviders.includes(provider)) {
        expect(populated.customModels).toEqual([{ id: "private-model" }]);
      } else {
        expect(populated).not.toHaveProperty("customModels");
      }
    }
  });
  test("includes routing only for OpenRouter", () => {
    const openRouterRouting = {
      dataCollection: "deny",
      requireParameters: true,
      zdr: false,
    } as const;

    expect(
      buildCreateProviderRequest({
        apiKey: "key",
        openRouterRouting,
        provider: "openrouter",
      }).openRouterRouting
    ).toEqual(openRouterRouting);
    expect(
      buildCreateProviderRequest({
        apiKey: "key",
        openRouterRouting,
        provider: "openai",
      })
    ).not.toHaveProperty("openRouterRouting");
    expect(
      buildCreateProviderRequest({ apiKey: "key", provider: "openrouter" })
    ).not.toHaveProperty("openRouterRouting");
    expect(
      buildCreateProviderRequest({
        apiKey: "key",
        openRouterRouting: {},
        provider: "openrouter",
      })
    ).not.toHaveProperty("openRouterRouting");
  });

  test("keeps normalized connection fields and model selection", () => {
    expect(
      buildCreateProviderRequest({
        apiKey: "key",
        baseUrl: " http://localhost:11434 ",
        displayName: " Local ",
        hostMode: "local",
        model: "model-1",
        provider: "ollama",
        wireApi: "responses",
      })
    ).toEqual({
      apiKey: "key",
      baseUrl: "http://localhost:11434",
      hostMode: "local",
      label: "Local",
      model: "model-1",
      type: "ollama",
      wireApi: "responses",
    });
  });
});

function group(
  providerId: string,
  provider: ProviderName,
  flags?: {
    supportsThinking?: boolean;
    supportsVision?: boolean;
    contextWindow?: number;
  }
) {
  return [
    {
      models: [
        {
          id: "model-1",
          name: "Model 1",
          provider,
          // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
          ...(flags?.supportsThinking === undefined
            ? {}
            : { supportsThinking: flags.supportsThinking }),
          // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
          ...(flags?.supportsVision === undefined
            ? {}
            : { supportsVision: flags.supportsVision }),
          // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
          ...(flags?.contextWindow === undefined
            ? {}
            : { contextWindow: flags.contextWindow }),
        },
      ],
      providerId,
      providerLabel: providerId,
    },
  ];
}

describe("resolveModelThinkingSupport", () => {
  test("explicit flags control thinking for every registered provider", () => {
    const explicitProviders: readonly ProviderName[] = [
      "xiaomi",
      "openai_compatible",
      "openrouter",
      "deepseek",
      "together",
      "vercel_ai_gateway",
      "mistral",
      "qwen",
      "qwen_cn",
      "doubao",
      "perplexity",
      "cerebras",
      "fireworks",
      "ollama",
    ];

    for (const provider of USER_PROVIDER_NAMES) {
      if (explicitProviders.includes(provider)) {
        expect(
          resolveModelThinkingSupport(
            encodeModelSelection("instance-one", "model-1"),
            group("instance-one", provider)
          )
        ).toBe(false);
      }

      for (const supportsThinking of [false, true]) {
        expect(
          resolveModelThinkingSupport(
            encodeModelSelection("instance-one", "model-1"),
            group("instance-one", provider, { supportsThinking })
          )
        ).toBe(supportsThinking);
      }
    }
  });
});

describe("resolveModelVisionSupport", () => {
  test("explicit flags control vision for every registered provider", () => {
    const explicitProviders: readonly ProviderName[] = [
      "xiaomi",
      "openai_compatible",
      "opencode_go",
      "deepseek",
      "doubao",
      "cerebras",
      "together",
      "qwen",
      "qwen_cn",
      "perplexity",
      "vercel_ai_gateway",
      "fireworks",
      "openrouter",
      "mistral",
      "ollama",
    ];

    for (const provider of USER_PROVIDER_NAMES) {
      if (explicitProviders.includes(provider)) {
        expect(
          resolveModelVisionSupport(
            encodeModelSelection("instance-one", "model-1"),
            group("instance-one", provider)
          )
        ).toBe(false);
      }

      for (const supportsVision of [false, true]) {
        expect(
          resolveModelVisionSupport(
            encodeModelSelection("instance-one", "model-1"),
            group("instance-one", provider, { supportsVision })
          )
        ).toBe(supportsVision);
      }
    }
  });
});

describe("filterVisionCapableProviderGroups", () => {
  test("keeps only models with vision capability", () => {
    const groups = [
      ...group("openai-1", "openai"),
      ...group("compat-1", "openai_compatible"),
      ...group("compat-2", "openai_compatible", { supportsVision: true }),
    ];

    const filtered = filterVisionCapableProviderGroups(groups);

    expect(filtered.map((entry) => entry.providerId)).toEqual([
      "openai-1",
      "compat-2",
    ]);
    expect(filtered[1]?.models.map((model) => model.id)).toEqual(["model-1"]);
  });
});

describe("firstAvailableProviderOption", () => {
  test("falls through to the next free builtin, then custom", () => {
    expect(firstAvailableProviderOption(new Set(["openai"]), "openai")).toBe(
      "chatgpt"
    );
    expect(
      firstAvailableProviderOption(
        new Set([
          "openai",
          "chatgpt",
          "xai_oauth",
          "anthropic",
          "openrouter",
          "gemini",
          "deepseek",
          "netra",
          "doubao",
          "together",
          "xiaomi",
          "meta",
          "vercel_ai_gateway",
          "mistral",
          "qwen",
          "qwen_cn",
          "perplexity",
          "cerebras",
          "cloudflare",
          "fireworks",
          "opencode_go",
        ]),
        "openai"
      )
    ).toBe("ollama");
  });
});

describe("profileModelSelectionValue", () => {
  test("does not remap an explicit OpenAI selection onto Zen for a shared model id", () => {
    const groups = [
      {
        models: [
          {
            id: "gpt-5.6-luna",
            name: "gpt-5.6-luna",
            provider: "openai_compatible" as const,
          },
        ],
        providerId: "zen-1",
        providerLabel: "OpenCode Zen",
      },
      {
        models: [
          {
            id: "gpt-5.6-luna",
            name: "GPT-5.6 Luna",
            provider: "openai" as const,
          },
        ],
        providerId: "openai-1",
        providerLabel: "OpenAI",
      },
    ];

    expect(profileModelSelectionValue("openai-1::gpt-5.6-luna", groups)).toBe(
      "openai-1::gpt-5.6-luna"
    );
  });
});

describe("effectiveProfileModelSelection", () => {
  test("uses the active provider's default when the profile has no model", () => {
    const groups = [
      ...group("openai-1", "openai"),
      {
        models: [
          {
            default: true,
            id: "deepseek/deepseek-v4-flash-0731",
            name: "DeepSeek V4 Flash 0731",
            provider: "netra" as const,
          },
        ],
        providerId: "netra-1",
        providerLabel: "Netra Runtime",
      },
    ];

    expect(effectiveProfileModelSelection(null, groups, "netra-1")).toBe(
      "netra-1::deepseek/deepseek-v4-flash-0731"
    );
    expect(effectiveProfileModelSelection(null, groups, null)).toBeNull();
    expect(
      effectiveProfileModelSelection("openai-1::model-1", groups, "netra-1")
    ).toBe("openai-1::model-1");
  });
});

describe("isOpenCodeZenBaseUrl", () => {
  test("matches Zen v1 and rejects OpenCode Go", () => {
    expect(isOpenCodeZenBaseUrl("https://opencode.ai/zen/v1")).toBe(true);
    expect(isOpenCodeZenBaseUrl("https://opencode.ai/zen/v1/")).toBe(true);
    expect(isOpenCodeZenBaseUrl("https://opencode.ai/zen/go/v1")).toBe(false);
    expect(isOpenCodeZenBaseUrl("https://api.openai.com/v1")).toBe(false);
  });
});

describe("hasOpenCodeZenProvider", () => {
  test("detects Zen by base URL or label on openai_compatible", () => {
    expect(
      hasOpenCodeZenProvider([
        {
          baseUrl: "https://opencode.ai/zen/v1",
          label: "OpenCode Zen",
          type: "openai_compatible",
        },
      ])
    ).toBe(true);

    expect(
      hasOpenCodeZenProvider([
        {
          baseUrl: "https://localhost:11434/v1",
          label: "Ollama",
          type: "openai_compatible",
        },
      ])
    ).toBe(false);

    expect(
      hasOpenCodeZenProvider([
        { baseUrl: null, label: "OpenCode Zen", type: "openai_compatible" },
      ])
    ).toBe(true);

    expect(
      hasOpenCodeZenProvider([
        { baseUrl: "https://opencode.ai/zen/go/v1", type: "opencode_go" },
      ])
    ).toBe(false);
  });
});

describe("validateCustomModelsInput", () => {
  test("requires both $/1M rates or neither", () => {
    expect(
      validateCustomModelsInput([{ id: "m", inputPerMillionUsd: 1 }])
    ).toContain("both input and output");
    expect(
      validateCustomModelsInput([
        { id: "m", inputPerMillionUsd: 1, outputPerMillionUsd: 3 },
      ])
    ).toBeNull();
    expect(validateCustomModelsInput([{ id: "m" }])).toBeNull();
    expect(validateCustomModelsInput([{ id: " " }])).toBe(
      "Add at least one model."
    );
  });
});

describe("appendOpenRouterModelRow", () => {
  test("keeps the context window the browse row carried", () => {
    expect(
      appendOpenRouterModelRow(
        [],
        "anthropic/claude-sonnet-4-6",
        "Sonnet 4.6",
        {
          contextWindow: 1_000_000,
        }
      )
    ).toEqual([
      {
        contextWindow: 1_000_000,
        default: true,
        id: "anthropic/claude-sonnet-4-6",
        name: "Sonnet 4.6",
      },
    ]);
  });

  test("preserves existing rows and moves the default to the picked model", () => {
    expect(
      appendOpenRouterModelRow(
        [
          { contextWindow: 32_000, default: true, id: "a/one", name: "One" },
          { id: "a/two" },
          { id: "   " },
        ],
        "a/two",
        "Two"
      )
    ).toEqual([
      { contextWindow: 32_000, default: false, id: "a/one", name: "One" },
      { default: true, id: "a/two", name: "a/two" },
    ]);
  });
});
