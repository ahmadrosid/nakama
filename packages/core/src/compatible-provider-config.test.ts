import { describe, expect, test } from "bun:test";
import { validateCustomModels } from "./compatible-provider-config";

describe("validateCustomModels", () => {
  test("accepts supportsThinking when it is boolean", () => {
    const models = validateCustomModels([
      {
        id: "qwen3.6-35b",
        name: "Qwen 3.6 35B",
        default: true,
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
      ]),
    ).toThrow('Model "qwen3.6-35b" has invalid supportsThinking flag.');
  });
});
