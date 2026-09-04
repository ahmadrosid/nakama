import { describe, expect, test } from "bun:test";
import { USER_PROVIDER_NAMES } from "@nakama/core/provider-resolution";
import {
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
} from "./models";

function group(
  providerId: string,
  provider:
    | "openai_compatible"
    | "openai"
    | "opencode_go"
    | "openrouter"
    | "deepseek"
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
  test("treats openai-compatible models as opt-in only", () => {
    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("compat-1", "model-1"),
        group("compat-1", "openai_compatible")
      )
    ).toBe(false);

    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("compat-1", "model-1"),
        group("compat-1", "openai_compatible", { supportsThinking: true })
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

  test("treats openrouter models as opt-in only", () => {
    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("or-1", "model-1"),
        group("or-1", "openrouter")
      )
    ).toBe(false);

    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("or-1", "model-1"),
        group("or-1", "openrouter", { supportsThinking: true })
      )
    ).toBe(true);
  });

  test("treats deepseek models as opt-in only", () => {
    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("ds-1", "model-1"),
        group("ds-1", "deepseek")
      )
    ).toBe(false);

    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("ds-1", "model-1"),
        group("ds-1", "deepseek", { supportsThinking: true })
      )
    ).toBe(true);
  });

  test("treats cerebras models as opt-in only", () => {
    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("cb-1", "model-1"),
        group("cb-1", "cerebras")
      )
    ).toBe(false);

    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("cb-1", "model-1"),
        group("cb-1", "cerebras", { supportsThinking: true })
      )
    ).toBe(true);
  });

  test("treats fireworks models as opt-in only", () => {
    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("fw-1", "model-1"),
        group("fw-1", "fireworks")
      )
    ).toBe(false);

    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("fw-1", "model-1"),
        group("fw-1", "fireworks", { supportsThinking: true })
      )
    ).toBe(true);
  });
});

describe("resolveModelVisionSupport", () => {
  test("treats openai-compatible and opencode_go models as opt-in only", () => {
    expect(
      resolveModelVisionSupport(
        encodeModelSelection("compat-1", "model-1"),
        group("compat-1", "openai_compatible")
      )
    ).toBe(false);

    expect(
      resolveModelVisionSupport(
        encodeModelSelection("go-1", "model-1"),
        group("go-1", "opencode_go")
      )
    ).toBe(false);

    expect(
      resolveModelVisionSupport(
        encodeModelSelection("compat-1", "model-1"),
        group("compat-1", "openai_compatible", { supportsVision: true })
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

  test("treats cerebras models as opt-in only for vision", () => {
    expect(
      resolveModelVisionSupport(
        encodeModelSelection("cb-1", "model-1"),
        group("cb-1", "cerebras")
      )
    ).toBe(false);

    expect(
      resolveModelVisionSupport(
        encodeModelSelection("cb-1", "model-1"),
        group("cb-1", "cerebras", { supportsVision: true })
      )
    ).toBe(true);
  });

  test("treats fireworks models as opt-in only for vision", () => {
    expect(
      resolveModelVisionSupport(
        encodeModelSelection("fw-1", "model-1"),
        group("fw-1", "fireworks")
      )
    ).toBe(false);

    expect(
      resolveModelVisionSupport(
        encodeModelSelection("fw-1", "model-1"),
        group("fw-1", "fireworks", { supportsVision: true })
      )
    ).toBe(true);
  });

  test("treats openrouter models as opt-in only for vision", () => {
    expect(
      resolveModelVisionSupport(
        encodeModelSelection("or-1", "model-1"),
        group("or-1", "openrouter")
      )
    ).toBe(false);

    expect(
      resolveModelVisionSupport(
        encodeModelSelection("or-1", "model-1"),
        group("or-1", "openrouter", { supportsVision: true })
      )
    ).toBe(true);
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
      "anthropic"
    );
    expect(
      firstAvailableProviderOption(
        new Set([
          "openai",
          "anthropic",
          "openrouter",
          "gemini",
          "deepseek",
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
