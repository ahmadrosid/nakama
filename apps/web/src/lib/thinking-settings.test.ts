import { describe, expect, test } from "bun:test";
import {
  buildAutoEnableThinkingPayload,
  shouldAutoEnableThinking,
  shouldBlockThinkingEffortChange,
  shouldShowThinkingBlocks,
  shouldShowThinkingEffort,
  thinkingEffortLabel,
} from "./thinking-settings";

describe("thinking-settings helpers", () => {
  test("shouldShowThinkingEffort is true only when model explicitly supports thinking", () => {
    expect(shouldShowThinkingEffort(true)).toBe(true);
    expect(shouldShowThinkingEffort(false)).toBe(false);
    expect(shouldShowThinkingEffort(undefined)).toBe(false);
  });

  test("shouldShowThinkingBlocks matches effort visibility gate", () => {
    expect(shouldShowThinkingBlocks).toBe(shouldShowThinkingEffort);
    expect(shouldShowThinkingBlocks(true)).toBe(true);
    expect(shouldShowThinkingBlocks(undefined)).toBe(false);
  });

  test("buildAutoEnableThinkingPayload always enables thinking", () => {
    expect(buildAutoEnableThinkingPayload({ effort: "high" })).toEqual({
      effort: "high",
      enabled: true,
    });
    expect(buildAutoEnableThinkingPayload({ effort: "medium" })).toEqual({
      effort: "medium",
      enabled: true,
    });
  });

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

  test("shouldBlockThinkingEffortChange blocks while busy", () => {
    expect(shouldBlockThinkingEffortChange(true)).toBe(true);
    expect(shouldBlockThinkingEffortChange(false)).toBe(false);
  });

  test("thinkingEffortLabel maps effort values", () => {
    expect(thinkingEffortLabel("medium")).toBe("Medium");
  });
});
