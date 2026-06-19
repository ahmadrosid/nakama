import { describe, expect, test } from "bun:test";
import { encodeModelSelection, resolveModelThinkingSupport } from "./models";

function group(
  providerId: string,
  provider: "openai_compatible" | "openai",
  supportsThinking?: boolean,
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
          ...(supportsThinking !== undefined ? { supportsThinking } : {}),
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
        group("compat-1", "openai_compatible", true),
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
        group("openai-1", "openai", false),
      ),
    ).toBe(false);
  });
});
