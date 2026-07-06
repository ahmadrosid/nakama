import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "@nakama/core";
import {
  extractTextAndThinkingFromParts,
  parseGeminiFunctionCalls,
  toGeminiContents,
} from "./messages";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("toGeminiContents", () => {
  test("maps user text and assistant tool calls", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call_1", name: "write_file", arguments: { path: "a.txt" } },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_1",
        name: "write_file",
        content: '{"ok":true}',
      },
    ];

    const contents = await toGeminiContents(messages);

    expect(contents).toHaveLength(3);
    expect(contents[0]?.role).toBe("user");
    expect(contents[0]?.parts?.[0]?.text).toBe("Hello");
    expect(contents[1]?.role).toBe("model");
    expect(contents[1]?.parts?.[0]?.functionCall).toEqual({
      id: "call_1",
      name: "write_file",
      args: { path: "a.txt" },
    });
    expect(contents[2]?.parts?.[0]?.functionResponse?.name).toBe("write_file");
    expect(contents[2]?.parts?.[0]?.functionResponse?.id).toBe("call_1");
  });

  test("maps image parts to inlineData", async () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          { type: "image", mediaType: "image/png", data: tinyPngBase64 },
        ],
      },
    ];

    const contents = await toGeminiContents(messages);

    expect(contents[0]?.parts?.[0]?.text).toBe("What is this?");
    expect(contents[0]?.parts?.[1]?.inlineData).toEqual({
      mimeType: "image/png",
      data: tinyPngBase64,
    });
  });
});

describe("parseGeminiFunctionCalls", () => {
  test("parses function calls with ids", () => {
    expect(
      parseGeminiFunctionCalls([
        { id: "fc1", name: "write_file", args: { path: "a.txt" } },
      ]),
    ).toEqual([
      { id: "fc1", name: "write_file", arguments: { path: "a.txt" } },
    ]);
  });
});

describe("extractTextAndThinkingFromParts", () => {
  test("separates thought parts from response text", () => {
    expect(
      extractTextAndThinkingFromParts([
        { text: "Plan", thought: true },
        { text: "Answer" },
      ]),
    ).toEqual({ content: "Answer", thinking: "Plan" });
  });
});
