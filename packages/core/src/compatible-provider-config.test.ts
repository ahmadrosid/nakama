import { describe, expect, test } from "bun:test";
import { validateCustomModels } from "./compatible-provider-config";

describe("validateCustomModels", () => {
  test("accepts supportsThinking when it is boolean", () => {
    const models = validateCustomModels([
      {
        default: true,
        id: "qwen3.6-35b",
        name: "Qwen 3.6 35B",
        supportsThinking: true,
      },
    ]);

    expect(models[0]?.supportsThinking).toBe(true);
  });

  test("rejects non-boolean supportsThinking values", () => {
    expect(() =>
      validateCustomModels([
        {
          id: "qwen3.6-35b",
          supportsThinking: "yes",
        },
      ])
    ).toThrow('Model "qwen3.6-35b" has invalid supportsThinking flag.');
  });

  test("keeps context sizes and leaves them undefined when blank", () => {
    const [sized, blank] = validateCustomModels([
      {
        contextWindow: 1_000_000,
        id: "qwen3.6-35b",
        maxOutputTokens: 32_768,
      },
      { contextWindow: "", id: "qwen3.6-7b" },
    ]);

    expect(sized?.contextWindow).toBe(1_000_000);
    expect(sized?.maxOutputTokens).toBe(32_768);
    expect(blank?.contextWindow).toBeUndefined();
  });

  test("rejects context sizes that are not positive whole token counts", () => {
    for (const contextWindow of [0, -1, 1.5, "many"]) {
      expect(() =>
        validateCustomModels([{ contextWindow, id: "qwen3.6-35b" }])
      ).toThrow(/invalid contextWindow/);
    }
  });
});
