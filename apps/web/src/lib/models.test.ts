import { describe, expect, test } from "bun:test";
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
  isProviderTypeAlreadyConfigured,
  knownModelSelection,
  PROVIDER_OPTIONS,
  profileModelSelectionValue,
  resolveModelThinkingSupport,
  resolveModelVisionSupport,
  validateCustomModelsInput,
} from "./models";

describe("buildCreateProviderRequest", () => {
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

  test.each([
    ["openai_compatible", true, true],
    ["openrouter", true, false],
    ["xai_oauth", true, false],
    ["chatgpt", true, false],
    ["cerebras", true, false],
    ["fireworks", true, false],
    ["ollama", true, false],
    ["opencode_go", true, false],
    ["openai", false, false],
  ] as const)(
    "preserves custom-model handling for %s",
    (provider, populated, empty) => {
      for (const customModels of [undefined, [], [{ id: "custom-model" }]]) {
        const request = buildCreateProviderRequest({
          apiKey: "key",
          customModels,
          provider,
        });
        const include =
          customModels && (customModels.length ? populated : empty);
        expect(request).toEqual({
          apiKey: "key",
          type: provider,
          ...(include ? { customModels } : {}),
        });
      }
    }
  );

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
  provider:
    | "openai_compatible"
    | "openai"
    | "opencode_go"
    | "openrouter"
    | "deepseek"
    | "doubao"
    | "xiaomi"
    | "together"
    | "vercel_ai_gateway"
    | "mistral"
    | "qwen"
    | "qwen_cn"
    | "perplexity"
    | "cerebras"
    | "fireworks",
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
          ...(flags?.supportsThinking === undefined
            ? {}
            : { supportsThinking: flags.supportsThinking }),
          ...(flags?.supportsVision === undefined
            ? {}
            : { supportsVision: flags.supportsVision }),
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
  test.each([
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
  ] as const)("%s requires an explicit thinking flag", (provider) => {
    const selected = encodeModelSelection(provider, "model-1");
    expect(
      resolveModelThinkingSupport(selected, group(provider, provider))
    ).toBe(false);
    expect(
      resolveModelThinkingSupport(
        selected,
        group(provider, provider, { supportsThinking: true })
      )
    ).toBe(true);
  });

  test("preserves existing non-compatible behavior", () => {
    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("openai-1", "model-1"),
        group("openai-1", "openai")
      )
    ).toBe(true);

    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("openai-1", "model-1"),
        group("openai-1", "openai", { supportsThinking: false })
      )
    ).toBe(false);
  });
});

describe("resolveModelVisionSupport", () => {
  test.each([
    "xiaomi",
    "openai_compatible",
    "opencode_go",
    "doubao",
    "cerebras",
    "together",
    "qwen",
    "vercel_ai_gateway",
    "fireworks",
    "openrouter",
  ] as const)("%s requires an explicit vision flag", (provider) => {
    const selected = encodeModelSelection(provider, "model-1");
    expect(resolveModelVisionSupport(selected, group(provider, provider))).toBe(
      false
    );
    expect(
      resolveModelVisionSupport(
        selected,
        group(provider, provider, { supportsVision: true })
      )
    ).toBe(true);
  });

  test("defaults first-party models to vision-capable", () => {
    expect(
      resolveModelVisionSupport(
        encodeModelSelection("openai-1", "model-1"),
        group("openai-1", "openai")
      )
    ).toBe(true);

    expect(
      resolveModelVisionSupport(
        encodeModelSelection("openai-1", "model-1"),
        group("openai-1", "openai", { supportsVision: false })
      )
    ).toBe(false);
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

describe("isProviderTypeAlreadyConfigured", () => {
  test("treats builtin providers as taken once configured", () => {
    const configured = new Set(["openai", "anthropic"]);

    expect(isProviderTypeAlreadyConfigured("openai", configured)).toBe(true);
    expect(isProviderTypeAlreadyConfigured("gemini", configured)).toBe(false);
  });

  test("always allows another openai_compatible instance", () => {
    const configured = new Set(["openai_compatible", "openai"]);

    expect(
      isProviderTypeAlreadyConfigured("openai_compatible", configured)
    ).toBe(false);
  });

  test("always allows another ollama instance", () => {
    const configured = new Set(["ollama", "openai"]);

    expect(isProviderTypeAlreadyConfigured("ollama", configured)).toBe(false);
  });
});

describe("PROVIDER_OPTIONS", () => {
  test("lists every registered provider type", () => {
    expect(PROVIDER_OPTIONS.map((option) => option.id).toSorted()).toEqual(
      [...USER_PROVIDER_NAMES].toSorted()
    );
  });
});

describe("firstAvailableProviderOption", () => {
  test("keeps preferred provider when it is still free", () => {
    expect(firstAvailableProviderOption(new Set(["anthropic"]), "openai")).toBe(
      "openai"
    );
  });

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

describe("knownModelSelection", () => {
  const groups = group("openai-1", "openai");

  test("keeps a remembered pick that still exists", () => {
    expect(knownModelSelection("openai-1::model-1", groups)).toBe(
      "openai-1::model-1"
    );
  });

  test("re-encodes a bare model id onto its provider", () => {
    expect(knownModelSelection("model-1", groups)).toBe("openai-1::model-1");
  });

  test("drops a pick whose provider or model is gone", () => {
    expect(knownModelSelection("openai-1::retired-model", groups)).toBeNull();
    expect(knownModelSelection("deleted-provider::model-9", groups)).toBeNull();
  });

  test("keeps the pick while the catalog has not loaded", () => {
    expect(knownModelSelection("openai-1::model-1", [])).toBe(
      "openai-1::model-1"
    );
  });

  test("returns null for an empty selection", () => {
    expect(knownModelSelection(null, groups)).toBeNull();
    expect(knownModelSelection("", groups)).toBeNull();
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
