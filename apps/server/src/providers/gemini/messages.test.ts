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
      { content: "Hello", role: "user" },
      {
        content: "",
        role: "assistant",
        toolCalls: [
          { arguments: { path: "a.txt" }, id: "call_1", name: "write_file" },
        ],
      },
      {
        content: '{"ok":true}',
        name: "write_file",
        role: "tool",
        toolCallId: "call_1",
      },
    ];

    const contents = await toGeminiContents(messages);

    expect(contents).toHaveLength(3);
    expect(contents[0]?.role).toBe("user");
    expect(contents[0]?.parts?.[0]?.text).toBe("Hello");
    expect(contents[1]?.role).toBe("model");
    expect(contents[1]?.parts?.[0]?.functionCall).toEqual({
      args: { path: "a.txt" },
      id: "call_1",
      name: "write_file",
    });
    expect(contents[2]?.parts?.[0]?.functionResponse?.name).toBe("write_file");
    expect(contents[2]?.parts?.[0]?.functionResponse?.id).toBe("call_1");
  });

  test("maps image parts to inlineData", async () => {
    const messages: ChatMessage[] = [
      {
        content: [
          { text: "What is this?", type: "text" },
          { data: tinyPngBase64, mediaType: "image/png", type: "image" },
        ],
        role: "user",
      },
    ];

    const contents = await toGeminiContents(messages);

    expect(contents[0]?.parts?.[0]?.text).toBe("What is this?");
    expect(contents[0]?.parts?.[1]?.inlineData).toEqual({
      data: tinyPngBase64,
      mimeType: "image/png",
    });
  });
});

describe("parseGeminiFunctionCalls", () => {
  test("parses function calls with ids", () => {
    expect(
      parseGeminiFunctionCalls([
        { args: { path: "a.txt" }, id: "fc1", name: "write_file" },
      ])
    ).toEqual([
      { arguments: { path: "a.txt" }, id: "fc1", name: "write_file" },
    ]);
  });
});

describe("extractTextAndThinkingFromParts", () => {
  test("separates thought parts from response text", () => {
    expect(
      extractTextAndThinkingFromParts([
        { text: "Plan", thought: true },
        { text: "Answer" },
      ])
    ).toEqual({ content: "Answer", thinking: "Plan" });
  });
});
