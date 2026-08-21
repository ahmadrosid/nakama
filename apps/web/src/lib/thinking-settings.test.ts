import { describe, expect, test } from "bun:test";
import { shouldAutoEnableThinking } from "./thinking-settings";

describe("thinking-settings helpers", () => {
  test("shouldAutoEnableThinking respects guards", () => {
    const disabled = { effort: "low" as const, enabled: false };

    expect(shouldAutoEnableThinking(disabled, true, false, false)).toBe(true);
    expect(shouldAutoEnableThinking(disabled, true, true, false)).toBe(false);
    expect(shouldAutoEnableThinking(disabled, false, false, false)).toBe(false);
    expect(shouldAutoEnableThinking(disabled, true, false, true)).toBe(false);
    expect(
      shouldAutoEnableThinking(
        { effort: "low", enabled: true },
        true,
        false,
        false
      )
    ).toBe(false);
    expect(
      shouldAutoEnableThinking(disabled, true, false, false, {
        hasRouteSession: true,
      })
    ).toBe(false);
    expect(
      shouldAutoEnableThinking(disabled, true, false, false, {
        hasMessages: true,
      })
    ).toBe(false);
    expect(
      shouldAutoEnableThinking(disabled, true, false, false, {
        hasProfileId: false,
      })
    ).toBe(false);
  });
});
