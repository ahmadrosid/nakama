import { describe, expect, test } from "bun:test";
import type { ProviderName } from "@nakama/core";
import { USER_PROVIDER_NAMES } from "@nakama/core/provider-resolution";
import {
  buildCreateProviderRequest,
  effectiveProfileModelSelection,
  encodeModelSelection,
  filterVisionCapableProviderGroups,
  firstAvailableProviderOption,
  isLocalBaseUrl,
  profileModelSelectionValue,
  resolveModelThinkingSupport,
  resolveModelVisionSupport,
  resolveOpenRouterSetupModel,
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
      "openai",
      "anthropic",
      "gemini",
      "deepseek",
      "doubao",
      "together",
      "xiaomi",
      "meta",
      "vercel_ai_gateway",
      "mistral",
      "qwen",
      "qwen_cn",
      "perplexity",
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
      "netra",
      "groq",
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

  test("rejects the same model ID twice", () => {
    expect(
      validateCustomModelsInput([{ id: "m" }, { id: " m " }])
    ).not.toBeNull();
    expect(validateCustomModelsInput([{ id: "m" }, { id: "n" }])).toBeNull();
  });
});

describe("isLocalBaseUrl", () => {
  test("treats loopback and private hosts as local", () => {
    expect(isLocalBaseUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLocalBaseUrl("http://192.168.1.4:8000/v1")).toBe(true);
    expect(isLocalBaseUrl("https://apihub.agnes-ai.com/v1")).toBe(false);
  });
});

describe("resolveOpenRouterSetupModel", () => {
  test("the row marked default wins over the catalog pick", () => {
    expect(
      resolveOpenRouterSetupModel(
        [{ id: "a/one" }, { default: true, id: "a/two" }],
        "a/one"
      )
    ).toBe("a/two");
  });

  test("with no row marked, the catalog pick stays", () => {
    expect(
      resolveOpenRouterSetupModel([{ id: "a/one" }, { id: "a/two" }], "a/two")
    ).toBe("a/two");
  });
});
