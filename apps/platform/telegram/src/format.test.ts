import { describe, expect, test } from "bun:test";
import {
  prepareTelegramReply,
  renderTelegramRichText,
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

describe("renderTelegramRichText", () => {
  test("renders common markdown as Telegram HTML", () => {
    expect(
      renderTelegramRichText("Hello **world**, `code`, and [docs](https://example.com)."),
    ).toBe(
      'Hello <b>world</b>, <code>code</code>, and <a href="https://example.com">docs</a>.',
    );
  });

  test("does not italicize underscores or double-escape query params in links", () => {
    expect(renderTelegramRichText("[docs](https://example.com/a_b?x=1&y=2)")).toBe(
      '<a href="https://example.com/a_b?x=1&amp;y=2">docs</a>',
    );
  });

  test("preserves snake case identifiers with underscores", () => {
    expect(renderTelegramRichText("Use active_org_id for org context.")).toBe(
      "Use active_org_id for org context.",
    );
  });

  test("escapes raw html while preserving fenced code blocks", () => {
    expect(renderTelegramRichText("Before <tag>\n```js\nconst x = 1 < 2;\n```")).toBe(
      "Before &lt;tag&gt;\n<pre><code>const x = 1 &lt; 2;</code></pre>",
    );
  });
});

describe("prepareTelegramReply", () => {
  test("preserves markdown for rich telegram delivery", () => {
    expect(prepareTelegramReply("  Hello **world** and `code`  ")).toBe(
      "Hello **world** and `code`",
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
