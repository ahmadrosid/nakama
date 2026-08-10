import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "@nakama/core";
import {
  formatHttpErrorBody,
  normalizeThinkingEffort,
  parseJsonRecord,
  readRecord,
  readSseEvents,
  sanitizeToolCallHistory,
} from "./shared";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }

      controller.close();
    },
  });
}

describe("provider shared helpers", () => {
  test("readSseEvents parses event names and skips done markers", async () => {
    const events: Array<{ event: string; data: string }> = [];

    await readSseEvents(
      streamFromChunks([
        'event: message\ndata: {"chunk":1}\n\n',
        'event: custom\ndata: {"chunk":2}\n\n',
        "data: [DONE]\n\n",
      ]),
      (event) => {
        events.push(event);
      }
    );

    expect(events).toEqual([
      { data: '{"chunk":1}', event: "message" },
      { data: '{"chunk":2}', event: "custom" },
    ]);
  });

  test("readSseEvents supports CRLF and data lines without a space", async () => {
    const events: Array<{ event: string; data: string }> = [];

    await readSseEvents(
      streamFromChunks([
        'event: custom\r\ndata:{"chunk":',
        '1}\r\n\r\ndata:{"chunk":2}\r\n\r\n',
      ]),
      (event) => {
        events.push(event);
      }
    );

    expect(events).toEqual([
      { data: '{"chunk":1}', event: "custom" },
      { data: '{"chunk":2}', event: "message" },
    ]);
  });

  test("parseJsonRecord returns empty objects for invalid JSON", () => {
    expect(parseJsonRecord('{"ok":true}')).toEqual({ ok: true });
    expect(parseJsonRecord("[]")).toEqual({});
    expect(parseJsonRecord("")).toEqual({});
    expect(parseJsonRecord("{bad json")).toEqual({});
  });

  test("readRecord only accepts plain records", () => {
    expect(readRecord({ ok: true })).toEqual({ ok: true });
    expect(readRecord(null)).toEqual({});
    expect(readRecord([])).toEqual({});
    expect(readRecord("text")).toEqual({});
  });

  test("normalizeThinkingEffort falls back to medium", () => {
    expect(normalizeThinkingEffort("low")).toBe("low");
    expect(normalizeThinkingEffort("high")).toBe("high");
    expect(normalizeThinkingEffort(undefined)).toBe("medium");
  });

  test("formatHttpErrorBody extracts OpenCode-style JSON errors", () => {
    expect(
      formatHttpErrorBody(
        "OpenCode Zen",
        429,
        JSON.stringify({
          error: {
            message: "Rate limit exceeded. Please try again later.",
            type: "FreeUsageLimitError",
          },
          type: "error",
        })
      )
    ).toBe(
      "OpenCode Zen request failed (429 FreeUsageLimitError): Rate limit exceeded. Please try again later."
    );
  });

  test("sanitizeToolCallHistory drops orphaned tool_calls assistants", () => {
    const messages: ChatMessage[] = [
      { content: "Use the tool", role: "user" },
      {
        content: "",
        role: "assistant",
        toolCalls: [{ arguments: {}, id: "call_missing", name: "lookup" }],
      },
      { content: "Thanks", role: "user" },
    ];

    expect(sanitizeToolCallHistory(messages)).toEqual([
      { content: "Use the tool", role: "user" },
      { content: "Thanks", role: "user" },
    ]);
  });

  test("sanitizeToolCallHistory drops orphaned tool messages", () => {
    const messages: ChatMessage[] = [
      { content: "Hi", role: "user" },
      {
        content: "result",
        name: "lookup",
        role: "tool",
        toolCallId: "call_orphan",
      },
    ];

    expect(sanitizeToolCallHistory(messages)).toEqual([
      { content: "Hi", role: "user" },
    ]);
  });

  test("sanitizeToolCallHistory leaves intact tool pairs untouched", () => {
    const messages: ChatMessage[] = [
      { content: "Use the tool", role: "user" },
      {
        content: "",
        role: "assistant",
        thinking: "plan",
        toolCalls: [{ arguments: { q: "x" }, id: "call_1", name: "lookup" }],
      },
      {
        content: "ok",
        name: "lookup",
        role: "tool",
        toolCallId: "call_1",
      },
      { content: "Done", role: "assistant" },
    ];

    expect(sanitizeToolCallHistory(messages)).toEqual(messages);
  });
});
