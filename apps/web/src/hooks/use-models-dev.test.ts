import { describe, expect, test } from "bun:test";
import { parseModelsDevCatalog } from "./use-models-dev";

describe("parseModelsDevCatalog", () => {
  test("disables OpenCode Zen free models and keeps its paid ones", () => {
    const rows = parseModelsDevCatalog({
      opencode: {
        api: "https://opencode.ai/zen/v1",
        models: {
          "big-pickle": { cost: { input: 0, output: 0 } },
          "gpt-5": { cost: { input: 1, output: 2 } },
        },
        name: "OpenCode Zen",
      },
    });

    expect(
      rows.map(({ modelId, supported, unsupportedReason }) => ({
        modelId,
        supported,
        unsupportedReason,
      }))
    ).toEqual([
      {
        modelId: "big-pickle",
        supported: false,
        unsupportedReason: "OpenCode's free tier only works inside OpenCode",
      },
      { modelId: "gpt-5", supported: true, unsupportedReason: undefined },
    ]);
  });
});
