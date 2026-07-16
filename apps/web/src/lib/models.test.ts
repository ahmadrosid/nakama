import { describe, expect, test } from "bun:test";
import { encodeModelSelection, resolveModelThinkingSupport, resolveModelVisionSupport } from "./models";

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
