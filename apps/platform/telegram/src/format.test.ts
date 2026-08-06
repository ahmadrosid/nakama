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

  test("preserves legacy share tokens with underscores in bare URLs", () => {
    const shareUrl =
      "http://127.0.0.1:4310/s/tc_share_a7e24436b9bd4ec8bd60edba6d403c74f0b19596f27b440db85d7f171299bbdc";
    const footer =
      `context-engineering-slides.html: ${shareUrl}\n` +
      "Set Web Public URL in Nakama settings for absolute share links.";

    expect(stripMarkdownForTelegram(footer)).toBe(footer);
    expect(stripMarkdownForTelegram(footer)).toContain("tc_share_");
    expect(stripMarkdownForTelegram(footer)).not.toContain("/s/tcshare");
  });

  test("preserves current nkshare tokens in bare URLs", () => {
    const shareUrl =
      "https://app.example/s/nksharea7e24436b9bd4ec8bd60edba6d403c74f0b19596f27b440db85d7f171299bbdc";
    expect(stripMarkdownForTelegram(`file.html: ${shareUrl}`)).toContain("nkshare");
  });

  test("still strips italic markers outside URLs", () => {
    expect(stripMarkdownForTelegram("see _share_ then https://example.com/a_b")).toBe(
      "see share then https://example.com/a_b",
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

  test("renders headings as bold text", () => {
    expect(renderTelegramRichText("## Status")).toBe("<b>Status</b>");
  });

  test("does not italicize underscores or double-escape query params in links", () => {
    expect(renderTelegramRichText("[docs](https://example.com/a_b?x=1&y=2)")).toBe(
      '<a href="https://example.com/a_b?x=1&amp;y=2">docs</a>',
    );
  });

  test("leaves links with parentheses in the url unrendered", () => {
    expect(renderTelegramRichText("[docs](https://example.com/path_(draft))")).toBe(
      "[docs](https://example.com/path_(draft))",
    );
  });

  test("preserves snake case identifiers with underscores", () => {
    expect(renderTelegramRichText("Use active_org_id for org context.")).toBe(
      "Use active_org_id for org context.",
    );
  });

  test("escapes raw html while preserving fenced code blocks", () => {
    expect(renderTelegramRichText("Before <tag>\n```js\n  const x = 1 < 2;\n```")).toBe(
      "Before &lt;tag&gt;\n<pre><code>  const x = 1 &lt; 2;</code></pre>",
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
