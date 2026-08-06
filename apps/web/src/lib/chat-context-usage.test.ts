import { describe, expect, test } from "bun:test";
import type { ChatContextUsage } from "@nakama/core/contract";
import {
  contextUsageRatio,
  formatContextUsageLabel,
  formatTokenCount,
} from "./chat-context-usage";

const sample = (partial: Partial<ChatContextUsage> = {}): ChatContextUsage => ({
  usedTokens: 25_000,
  usableContextTokens: 100_000,
  contextWindow: 120_000,
  source: "provider",
  ...partial,
});

describe("contextUsageRatio", () => {
  test("uses usable context as the denominator", () => {
    expect(contextUsageRatio(sample({ usedTokens: 25_000, usableContextTokens: 100_000 }))).toBe(
      0.25,
    );
  });

  test("clamps between 0 and 1", () => {
    expect(contextUsageRatio(sample({ usedTokens: 200_000, usableContextTokens: 100_000 }))).toBe(1);
    expect(contextUsageRatio(sample({ usedTokens: -5, usableContextTokens: 100_000 }))).toBe(0);
  });
});

describe("formatTokenCount", () => {
  test("formats compact counts", () => {
    expect(formatTokenCount(42)).toBe("42");
    expect(formatTokenCount(1_500)).toBe("1.5k");
    expect(formatTokenCount(12_400)).toBe("12k");
    expect(formatTokenCount(1_200_000)).toBe("1.2M");
  });
});

describe("formatContextUsageLabel", () => {
  test("includes percent and usable context", () => {
    expect(formatContextUsageLabel(sample())).toBe("Context 25% · ~25k / 100k");
  });

  test("marks estimated usage", () => {
    expect(formatContextUsageLabel(sample({ source: "estimate" }))).toBe(
      "Context 25% · ~25k / 100k · estimated",
    );
  });
});
