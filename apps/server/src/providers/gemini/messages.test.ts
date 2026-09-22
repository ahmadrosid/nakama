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

describe("Gemini 2.5 function calls, which carry no id", () => {
  test("a call without an id is kept, not dropped", () => {
    // The exact shape 2.5 Flash returns. Requiring an id discarded it, the turn
    // then had no tool calls and no text, and the reply came back empty.
    const calls = parseGeminiFunctionCalls([
      { args: { query: "permit" }, name: "knowledge_base_search" },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("knowledge_base_search");
    expect(calls[0]?.arguments).toEqual({ query: "permit" });
  });

  test("a provider id is kept as it is", () => {
    const calls = parseGeminiFunctionCalls([
      { args: {}, id: "call_333446", name: "knowledge_base_search" },
    ]);

    expect(calls[0]?.id).toBe("call_333446");
  });

  test("two different tools in one turn stay apart", () => {
    const calls = parseGeminiFunctionCalls([
      { args: {}, name: "knowledge_base_search" },
      { args: {}, name: "web_fetch" },
    ]);

    expect(calls.map((call) => call.name)).toEqual([
      "knowledge_base_search",
      "web_fetch",
    ]);
    expect(new Set(calls.map((call) => call.id)).size).toBe(2);
  });

  test("a minted id is never sent back to the model", async () => {
    const [call] = parseGeminiFunctionCalls([
      { args: { query: "permit" }, name: "knowledge_base_search" },
    ]);
    const messages: ChatMessage[] = [
      { content: "cari", role: "user" },
      { content: "", role: "assistant", toolCalls: [call] },
      {
        content: '{"matchCount":1}',
        name: "knowledge_base_search",
        role: "tool",
        toolCallId: call.id,
      },
    ];

    const contents = await toGeminiContents(messages);
    const modelPart = contents[1]?.parts?.[0];
    const responsePart = contents[2]?.parts?.[0];

    // Gemini pairs a response to its call by id. It issued neither of these, so
    // sending the handle we minted would point at a call that never existed.
    expect(modelPart?.functionCall?.name).toBe("knowledge_base_search");
    expect(modelPart?.functionCall?.id).toBeUndefined();
    expect(responsePart?.functionResponse?.name).toBe("knowledge_base_search");
    expect(responsePart?.functionResponse?.id).toBeUndefined();
    expect("id" in (responsePart?.functionResponse ?? {})).toBe(false);
  });
});
