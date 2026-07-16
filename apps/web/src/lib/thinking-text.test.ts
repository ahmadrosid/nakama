import { describe, expect, test } from "bun:test";
import { splitThinkingLines } from "./thinking-text";

describe("splitThinkingLines", () => {
  test("returns empty array for blank input", () => {
    expect(splitThinkingLines("")).toEqual([]);
    expect(splitThinkingLines("   \n  ")).toEqual([]);
  });

  test("splits paragraph breaks and single newlines", () => {
    expect(splitThinkingLines("First line\nSecond line\n\nThird paragraph")).toEqual([
      "First line",
      "Second line",
      "Third paragraph",
    ]);
  });

  test("splits long prose into sentences", () => {
    const text =
      "First sentence here. Second sentence follows. Third sentence closes the thought.";
    expect(splitThinkingLines(text)).toEqual([
      "First sentence here.",
      "Second sentence follows.",
      "Third sentence closes the thought.",
    ]);
  });
});
