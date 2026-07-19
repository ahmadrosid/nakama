import { describe, expect, test } from "bun:test";
import {
  encodeModelSelection,
  firstAvailableProviderOption,
  hasOpenCodeZenProvider,
  isOpenCodeZenBaseUrl,
  isProviderTypeAlreadyConfigured,
  resolveModelThinkingSupport,
  resolveModelVisionSupport,
} from "./models";

function group(
  providerId: string,
  provider: "openai_compatible" | "openai" | "opencode_go" | "openrouter" | "deepseek" | "cerebras",
  flags?: { supportsThinking?: boolean; supportsVision?: boolean },
) {
  return [
    {
      providerId,
      providerLabel: providerId,
      models: [
        {
          id: "model-1",
          name: "Model 1",
          provider,
          ...(flags?.supportsThinking !== undefined
            ? { supportsThinking: flags.supportsThinking }
            : {}),
          ...(flags?.supportsVision !== undefined
            ? { supportsVision: flags.supportsVision }
            : {}),
        },
      ],
    },
  ];
}

describe("resolveModelThinkingSupport", () => {
  test("treats openai-compatible models as opt-in only", () => {
    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("compat-1", "model-1"),
        group("compat-1", "openai_compatible"),
      ),
    ).toBe(false);

    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("compat-1", "model-1"),
        group("compat-1", "openai_compatible", { supportsThinking: true }),
      ),
    ).toBe(true);
  });

  test("preserves existing non-compatible behavior", () => {
    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("openai-1", "model-1"),
        group("openai-1", "openai"),
      ),
    ).toBe(true);

    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("openai-1", "model-1"),
        group("openai-1", "openai", { supportsThinking: false }),
      ),
    ).toBe(false);
  });

  test("treats openrouter models as opt-in only", () => {
    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("or-1", "model-1"),
        group("or-1", "openrouter"),
      ),
    ).toBe(false);

    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("or-1", "model-1"),
        group("or-1", "openrouter", { supportsThinking: true }),
      ),
    ).toBe(true);
  });

  test("treats deepseek models as opt-in only", () => {
    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("ds-1", "model-1"),
        group("ds-1", "deepseek"),
      ),
    ).toBe(false);

    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("ds-1", "model-1"),
        group("ds-1", "deepseek", { supportsThinking: true }),
      ),
    ).toBe(true);
  });

  test("treats cerebras models as opt-in only", () => {
    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("cb-1", "model-1"),
        group("cb-1", "cerebras"),
      ),
    ).toBe(false);

    expect(
      resolveModelThinkingSupport(
        encodeModelSelection("cb-1", "model-1"),
        group("cb-1", "cerebras", { supportsThinking: true }),
      ),
    ).toBe(true);
  });
});

describe("resolveModelVisionSupport", () => {
  test("treats openai-compatible and opencode_go models as opt-in only", () => {
    expect(
      resolveModelVisionSupport(
        encodeModelSelection("compat-1", "model-1"),
        group("compat-1", "openai_compatible"),
      ),
    ).toBe(false);

    expect(
      resolveModelVisionSupport(
        encodeModelSelection("go-1", "model-1"),
        group("go-1", "opencode_go"),
      ),
    ).toBe(false);

    expect(
      resolveModelVisionSupport(
        encodeModelSelection("compat-1", "model-1"),
        group("compat-1", "openai_compatible", { supportsVision: true }),
      ),
    ).toBe(true);
  });

  test("defaults first-party models to vision-capable", () => {
    expect(
      resolveModelVisionSupport(
        encodeModelSelection("openai-1", "model-1"),
        group("openai-1", "openai"),
      ),
    ).toBe(true);

    expect(
      resolveModelVisionSupport(
        encodeModelSelection("openai-1", "model-1"),
        group("openai-1", "openai", { supportsVision: false }),
      ),
    ).toBe(false);
  });

  test("treats cerebras models as opt-in only for vision", () => {
    expect(
      resolveModelVisionSupport(
        encodeModelSelection("cb-1", "model-1"),
        group("cb-1", "cerebras"),
      ),
    ).toBe(false);

    expect(
      resolveModelVisionSupport(
        encodeModelSelection("cb-1", "model-1"),
        group("cb-1", "cerebras", { supportsVision: true }),
      ),
    ).toBe(true);
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

    expect(isProviderTypeAlreadyConfigured("openai_compatible", configured)).toBe(false);
  });
});

describe("firstAvailableProviderOption", () => {
  test("keeps preferred provider when it is still free", () => {
    expect(firstAvailableProviderOption(new Set(["anthropic"]), "openai")).toBe("openai");
  });

  test("falls through to the next free builtin, then custom", () => {
    expect(firstAvailableProviderOption(new Set(["openai"]), "openai")).toBe("anthropic");
    expect(
      firstAvailableProviderOption(
        new Set([
          "openai",
          "anthropic",
          "openrouter",
          "gemini",
          "deepseek",
          "cerebras",
          "opencode_go",
        ]),
        "openai",
      ),
    ).toBe("openai_compatible");
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
        { type: "openai_compatible", baseUrl: "https://opencode.ai/zen/v1", label: "OpenCode Zen" },
      ]),
    ).toBe(true);

    expect(
      hasOpenCodeZenProvider([
        { type: "openai_compatible", baseUrl: "https://localhost:11434/v1", label: "Ollama" },
      ]),
    ).toBe(false);

    expect(
      hasOpenCodeZenProvider([
        { type: "openai_compatible", baseUrl: null, label: "OpenCode Zen" },
      ]),
    ).toBe(true);

    expect(
      hasOpenCodeZenProvider([{ type: "opencode_go", baseUrl: "https://opencode.ai/zen/go/v1" }]),
    ).toBe(false);
  });
});
