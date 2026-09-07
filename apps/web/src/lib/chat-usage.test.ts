import { describe, expect, test } from "bun:test";
import {
  addChatUsage,
  chatUsageTitle,
  formatChatUsage,
  sumChatUsage,
} from "./chat-usage";

describe("chat usage", () => {
  test("sums tokens and keeps cost only when every side has one", () => {
    const priced = addChatUsage(
      { costUsd: 0.001, inputTokens: 100, outputTokens: 10, totalTokens: 110 },
      { costUsd: 0.002, inputTokens: 200, outputTokens: 20, totalTokens: 220 }
    );
    expect(priced).toEqual({
      costUsd: 0.003,
      inputTokens: 300,
      outputTokens: 30,
      totalTokens: 330,
    });

    const unpriced = addChatUsage(priced, {
      estimated: true,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    });
    expect(unpriced).toEqual({
      estimated: true,
      inputTokens: 301,
      outputTokens: 31,
      totalTokens: 332,
    });
  });

  test("sumChatUsage only counts assistant messages", () => {
    expect(
      sumChatUsage([
        { role: "user" },
        {
          role: "assistant",
          usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
        },
        { role: "tool" },
        {
          role: "assistant",
          usage: { inputTokens: 7, outputTokens: 2, totalTokens: 9 },
        },
      ])
    ).toEqual({ inputTokens: 12, outputTokens: 3, totalTokens: 15 });
    expect(sumChatUsage([{ role: "assistant" }])).toBeUndefined();
  });

  test("formats tokens, cost and the estimate marker", () => {
    expect(
      formatChatUsage({
        costUsd: 0.0042,
        inputTokens: 1234,
        outputTokens: 56,
        totalTokens: 1290,
      })
    ).toBe("1.2k in · 56 out · $0.0042");
    expect(
      formatChatUsage({
        estimated: true,
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
      })
    ).toBe("~10 in · 2 out");
  });

  test("compacts token counts at each thousand step", () => {
    const compacted = (inputTokens: number) =>
      formatChatUsage({
        inputTokens,
        outputTokens: 0,
        totalTokens: inputTokens,
      }).replace(" in · 0 out", "");

    expect(compacted(945)).toBe("945");
    expect(compacted(1234)).toBe("1.2k");
    expect(compacted(12_345)).toBe("12k");
    expect(compacted(123_456)).toBe("123k");
    expect(compacted(1_234_567)).toBe("1.2m");
    expect(compacted(1_500_000_000)).toBe("1.5b");
    expect(compacted(2_300_000_000_000)).toBe("2.3t");
  });

  test("keeps the exact count in the hover title", () => {
    expect(
      chatUsageTitle({ inputTokens: 1200, outputTokens: 34, totalTokens: 1234 })
    ).toContain("1,234 tokens");
  });
});
