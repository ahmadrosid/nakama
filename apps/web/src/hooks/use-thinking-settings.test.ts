import { describe, expect, test } from "bun:test";
import { buildThinkingSettingsPayload } from "./use-thinking-settings";

describe("buildThinkingSettingsPayload", () => {
  test("always enables thinking with the selected effort", () => {
    expect(buildThinkingSettingsPayload("high")).toEqual({
      effort: "high",
      enabled: true,
    });
    expect(buildThinkingSettingsPayload("low")).toEqual({
      effort: "low",
      enabled: true,
    });
  });
});
