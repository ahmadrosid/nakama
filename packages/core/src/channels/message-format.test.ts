import { describe, expect, test } from "bun:test";
import { splitTelegramChunks, truncateForChannel } from "./message-format";

describe("truncateForChannel", () => {
  test("truncates long telegram messages", () => {
    const text = "x".repeat(5000);
    const truncated = truncateForChannel(text, "telegram");

    expect(truncated.length).toBeLessThan(5000);
    expect(truncated).toContain("truncated");
  });

  test("truncates long discord messages to 2000", () => {
    const text = "x".repeat(2500);
    const truncated = truncateForChannel(text, "discord");

    expect(truncated.length).toBeLessThanOrEqual(2000);
    expect(truncated).toContain("truncated");
  });
});

describe("splitTelegramChunks", () => {
  test("splits oversized messages", () => {
    const chunks = splitTelegramChunks("a".repeat(5000), 1000);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 1000)).toBe(true);
  });
});
