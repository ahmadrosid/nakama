import { describe, expect, test } from "bun:test";
import {
  splitIntoChatBubbles,
  splitTelegramMessage,
  stripMarkdownForTelegram,
} from "./format";

describe("stripMarkdownForTelegram", () => {
  test("removes bold and inline code", () => {
    expect(stripMarkdownForTelegram("Hello **world** and `code`")).toBe(
      "Hello world and code",
    );
  });

  test("unwraps fenced code blocks", () => {
    expect(stripMarkdownForTelegram("Before\n```js\nconst x = 1;\n```\nAfter")).toBe(
      "Before\nconst x = 1;\nAfter",
    );
  });

  test("strips headings and link syntax", () => {
    expect(stripMarkdownForTelegram("## Title\n[docs](https://example.com)")).toBe(
      "Title\ndocs (https://example.com)",
    );
  });
});

describe("splitIntoChatBubbles", () => {
  test("returns empty for blank text", () => {
    expect(splitIntoChatBubbles("   ")).toEqual([]);
  });

  test("keeps short replies as one bubble", () => {
    expect(splitIntoChatBubbles("Hello there.")).toEqual(["Hello there."]);
  });

  test("splits on paragraph boundaries", () => {
    const text = "First paragraph.\n\nSecond paragraph.\n\nThird.";
    const bubbles = splitIntoChatBubbles(text, 40);

    expect(bubbles).toEqual([
      "First paragraph.\n\nSecond paragraph.",
      "Third.",
    ]);
  });

  test("splits long paragraphs by words", () => {
    const text = "word ".repeat(120).trim();
    const bubbles = splitIntoChatBubbles(text, 50);

    expect(bubbles.length).toBeGreaterThan(1);
    for (const bubble of bubbles) {
      expect(bubble.length).toBeLessThanOrEqual(50);
    }
  });
});

describe("splitTelegramMessage", () => {
  test("splits beyond telegram limit", () => {
    const text = "a".repeat(5000);
    const chunks = splitTelegramMessage(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
  });
});
