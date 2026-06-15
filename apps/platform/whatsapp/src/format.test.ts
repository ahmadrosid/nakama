import { describe, expect, test } from "bun:test";
import {
  splitWhatsAppMessage,
  stripMarkdownForWhatsApp,
  prepareWhatsAppReply,
} from "./format";

describe("stripMarkdownForWhatsApp", () => {
  test("converts double-bold to WhatsApp bold", () => {
    expect(stripMarkdownForWhatsApp("Hello **world**")).toBe("Hello *world*");
  });

  test("preserves WhatsApp italic markers", () => {
    expect(stripMarkdownForWhatsApp("Hello _world_")).toBe("Hello _world_");
  });

  test("removes inline code backticks", () => {
    expect(stripMarkdownForWhatsApp("Use `code` here")).toBe("Use code here");
  });

  test("unwraps fenced code blocks", () => {
    expect(stripMarkdownForWhatsApp("Before\n```js\nconst x = 1;\n```\nAfter")).toBe(
      "Before\nconst x = 1;\nAfter",
    );
  });

  test("strips headings", () => {
    expect(stripMarkdownForWhatsApp("## Title")).toBe("Title");
  });
});

describe("splitWhatsAppMessage", () => {
  test("returns single chunk for short text", () => {
    expect(splitWhatsAppMessage("Hello")).toEqual(["Hello"]);
  });

  test("splits text exceeding WhatsApp limit", () => {
    const text = "a".repeat(70_000);
    const chunks = splitWhatsAppMessage(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 65536)).toBe(true);
  });
});

describe("prepareWhatsAppReply", () => {
  test("strips markdown and trims", () => {
    expect(prepareWhatsAppReply("  **bold**  ")).toBe("*bold*");
  });
});