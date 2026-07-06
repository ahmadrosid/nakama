import { describe, expect, test } from "bun:test";
import {
  formatAutomationDeliveryMessage,
  splitTelegramChunks,
  truncateForChannel,
} from "./message-format";

describe("formatAutomationDeliveryMessage", () => {
  test("includes automation name and body", () => {
    const formatted = formatAutomationDeliveryMessage({
      automationName: "AI news",
      status: "completed",
      completedAt: "2026-06-29T08:00:00.000Z",
      body: "Summary text",
    });

    expect(formatted.subject).toBe("[Nakama] AI news — completed");
    expect(formatted.text).toContain("Summary text");
  });
});

describe("truncateForChannel", () => {
  test("truncates long telegram messages", () => {
    const text = "x".repeat(5000);
    const truncated = truncateForChannel(text, "telegram");

    expect(truncated.length).toBeLessThan(5000);
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
