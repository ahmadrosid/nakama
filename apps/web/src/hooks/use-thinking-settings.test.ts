import { describe, expect, test } from "bun:test";
import { buildThinkingSettingsPayload } from "./use-thinking-settings";

describe("buildThinkingSettingsPayload", () => {
  test("always enables thinking with the selected effort", () => {
    expect(buildThinkingSettingsPayload("high")).toEqual({
      enabled: true,
      effort: "high",
    });
    expect(buildThinkingSettingsPayload("low")).toEqual({
      enabled: true,
      effort: "low",
    });
  });
});
