import { describe, expect, test } from "bun:test";
import { splitTelegramChunks, truncateForChannel } from "./message-format";

describe("truncateForChannel", () => {
  test("truncates long whatsapp messages to 4096", () => {
    const text = "x".repeat(5000);
    const truncated = truncateForChannel(text, "whatsapp");

    expect(truncated.length).toBeLessThanOrEqual(4096);
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
