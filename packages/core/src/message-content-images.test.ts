import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "./contract";
import { messagesIncludeUserImages } from "./message-content";

describe("messagesIncludeUserImages", () => {
  test("detects image parts in user messages", () => {
    const messages: ChatMessage[] = [
      { content: "hello", role: "user" },
      {
        content: [
          { text: "see this", type: "text" },
          { data: "abc", mediaType: "image/png", type: "image" },
        ],
        role: "user",
      },
    ];

    expect(messagesIncludeUserImages(messages)).toBe(true);
  });

  test("returns false for text-only history", () => {
    const messages: ChatMessage[] = [
      { content: "hello", role: "user" },
      { content: "hi", role: "assistant" },
    ];

    expect(messagesIncludeUserImages(messages)).toBe(false);
  });
});
