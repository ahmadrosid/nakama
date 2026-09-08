import { describe, expect, test } from "bun:test";
import type { ChatContextUsage } from "@nakama/core/contract";
import {
  contextUsageRatio,
  contextUsageSegments,
  formatContextUsageLabel,
  formatTokenCount,
  formatTokenCountDetailed,
} from "./chat-context-usage";

const sample = (partial: Partial<ChatContextUsage> = {}): ChatContextUsage => ({
  contextWindow: 120_000,
  source: "provider",
  usableContextTokens: 100_000,
  usedTokens: 25_000,
  ...partial,
});

describe("contextUsageRatio", () => {
  test("uses usable context as the denominator", () => {
    expect(
      contextUsageRatio(
        sample({ usableContextTokens: 100_000, usedTokens: 25_000 })
      )
    ).toBe(0.25);
  });

  test("clamps between 0 and 1", () => {
    expect(
      contextUsageRatio(
        sample({ usableContextTokens: 100_000, usedTokens: 200_000 })
      )
    ).toBe(1);
    expect(
      contextUsageRatio(
        sample({ usableContextTokens: 100_000, usedTokens: -5 })
      )
    ).toBe(0);
  });
});

describe("formatTokenCount", () => {
  test("formats compact counts", () => {
    expect(formatTokenCount(42)).toBe("42");
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(12_400)).toBe("12k");
    expect(formatTokenCount(1_200_000)).toBe("1.2M");
  });
});

describe("formatTokenCountDetailed", () => {
  test("keeps a decimal for tens of thousands", () => {
    expect(formatTokenCountDetailed(60_500)).toBe("60.5k");
    expect(formatTokenCountDetailed(256_000)).toBe("256k");
  });
});

describe("contextUsageSegments", () => {
  test("lists measured buckets and drops empty ones", () => {
    expect(
      contextUsageSegments(
        sample({
          breakdown: {
            conversation: 36_700,
            systemPrompt: 1100,
            toolDefinitions: 9900,
          },
        })
      ).map((segment) => segment.id)
    ).toEqual(["systemPrompt", "toolDefinitions", "conversation"]);
  });

  test("adds other when the provider total is larger than the estimate", () => {
    const segments = contextUsageSegments(
      sample({
        breakdown: {
          conversation: 10_000,
          systemPrompt: 1000,
          toolDefinitions: 2000,
        },
        usedTokens: 20_000,
      })
    );
    expect(segments.at(-1)).toMatchObject({ id: "other", tokens: 7000 });
  });
});

describe("formatContextUsageLabel", () => {
  test("includes percent and usable context", () => {
    expect(formatContextUsageLabel(sample())).toBe("Context 25% · ~25k / 100k");
  });

  test("marks estimated usage", () => {
    expect(formatContextUsageLabel(sample({ source: "estimate" }))).toBe(
      "Context 25% · ~25k / 100k · estimated"
    );
  });
});
