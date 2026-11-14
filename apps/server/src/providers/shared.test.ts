import { describe, expect, test } from "bun:test";
import type { ChatMessage, ToolCall } from "@nakama/core";
import { NakamaApiError, ProviderStreamInterruptedError } from "@nakama/core";
import {
  buildProviderHttpError,
  dropEmptyEnumMembers,
  extractOpenAITokenUsage,
  finalizePendingToolCalls,
  formatHttpErrorBody,
  mergePendingToolCall,
  normalizeThinkingEffort,
  type PendingToolCall,
  parseJsonRecord,
  readRecord,
  readSseEvents,
  sanitizeToolCallHistory,
} from "./shared";
import { streamFromChunks } from "./test-helpers";

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

  test("readSseEvents turns a dropped socket into a stream interruption after earlier events", async () => {
    const events: string[] = [];
    let sent = false;

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          const drop = new TypeError(
            "The socket connection was closed unexpectedly."
          );

          controller.error(Object.assign(drop, { code: "ECONNRESET" }));

          return;
        }

        sent = true;
        controller.enqueue(new TextEncoder().encode('data: {"chunk":1}\n\n'));
      },
    });

    const error = await readSseEvents(body, ({ data }) => {
      events.push(data);
    }).catch((caught) => caught);

    expect(events).toEqual(['{"chunk":1}']);
    expect(error).toBeInstanceOf(ProviderStreamInterruptedError);
    expect(error.status).toBe(502);
    expect(error.cause).toMatchObject({
      code: "ECONNRESET",
      message: "The socket connection was closed unexpectedly.",
    });
  });

  test("readSseEvents keeps an abort as an abort", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(abort);
      },
    });

    const error = await readSseEvents(body, () => undefined).catch(
      (caught) => caught
    );

    expect(error).toBe(abort);
  });

  test("parseJsonRecord returns empty objects for invalid JSON", () => {
    expect(parseJsonRecord('{"ok":true}')).toEqual({ ok: true });
    expect(parseJsonRecord("[]")).toEqual({});
    expect(parseJsonRecord("")).toEqual({});
    expect(parseJsonRecord("{bad json")).toEqual({});
  });

  test("joins partial tool calls in index order and drops incomplete calls", () => {
    const pending = new Map<number, PendingToolCall>();
    mergePendingToolCall(pending, {
      function: { arguments: '{"second":' },
      index: 1,
    });
    mergePendingToolCall(pending, {
      function: { arguments: "{bad json", name: "first" },
      id: "call_0",
      index: 0,
    });
    mergePendingToolCall(pending, {
      function: { arguments: "2}", name: "second" },
      id: "call_1",
      index: 1,
    });
    mergePendingToolCall(pending, { id: "incomplete", index: 2 });

    expect(finalizePendingToolCalls(pending)).toEqual([
      { arguments: {}, id: "call_0", name: "first" },
      { arguments: { second: 2 }, id: "call_1", name: "second" },
    ]);
  });

  test("readRecord only accepts plain records", () => {
    expect(readRecord({ ok: true })).toEqual({ ok: true });
    expect(readRecord(null)).toEqual({});
    expect(readRecord([])).toEqual({});
    expect(readRecord("text")).toEqual({});
  });

  test("normalizeThinkingEffort falls back to medium", () => {
    expect(normalizeThinkingEffort("low", "gpt-5.4", "openai")).toBe("low");
    expect(normalizeThinkingEffort("high", "gpt-5.4", "openai")).toBe("high");
    expect(normalizeThinkingEffort(undefined, "gpt-5.4", "openai")).toBe(
      "medium"
    );
  });

  test("normalizeThinkingEffort lowers xhigh/max to what the host and model accept", () => {
    expect(normalizeThinkingEffort("max", "gpt-6-luna", "openai")).toBe("max");
    expect(normalizeThinkingEffort("max", "gpt-5.4", "openai")).toBe("xhigh");
    expect(
      normalizeThinkingEffort("xhigh", "deepseek-v4.1-flash", "deepseek")
    ).toBe("high");
    expect(
      normalizeThinkingEffort("max", "gemini-3.6-flash", "openrouter")
    ).toBe("high");
    expect(
      normalizeThinkingEffort("max", "deepseek-v4-flash:cloud", "ollama")
    ).toBe("high");
  });

  const user = (content: string): ChatMessage => ({ content, role: "user" });

  const toolResult = (toolCallId: string, content = "ok"): ChatMessage => ({
    content,
    name: "lookup",
    role: "tool",
    toolCallId,
  });

  const assistantTools = (
    id: string,
    args: ToolCall["arguments"] = {},
    thinking?: string
  ): ChatMessage => {
    const message: Extract<ChatMessage, { role: "assistant" }> = {
      content: "",
      role: "assistant",
      toolCalls: [{ arguments: args, id, name: "lookup" }],
    };

    if (thinking) {
      message.thinking = thinking;
    }

    return message;
  };

  test("sanitizeToolCallHistory drops orphaned tool_calls assistants", () => {
    expect(
      sanitizeToolCallHistory([
        user("Use the tool"),
        assistantTools("call_missing"),
        user("Thanks"),
      ])
    ).toEqual([user("Use the tool"), user("Thanks")]);
  });

  test("sanitizeToolCallHistory drops orphaned tool messages", () => {
    expect(
      sanitizeToolCallHistory([user("Hi"), toolResult("call_orphan", "result")])
    ).toEqual([user("Hi")]);
  });

  test("sanitizeToolCallHistory leaves intact tool pairs untouched", () => {
    const messages: ChatMessage[] = [
      user("Use the tool"),
      assistantTools("call_1", { q: "x" }, "plan"),
      toolResult("call_1"),
      { content: "Done", role: "assistant" },
    ];

    expect(sanitizeToolCallHistory(messages)).toEqual(messages);
  });
});

describe("extractOpenAITokenUsage", () => {
  test("keeps the cached prompt slice that OpenAI reports inside prompt_tokens", () => {
    expect(
      extractOpenAITokenUsage({
        completion_tokens: 10,
        prompt_tokens: 6348,
        prompt_tokens_details: { cached_tokens: 6144 },
        total_tokens: 6358,
      })
    ).toEqual({
      cachedInputTokens: 6144,
      inputTokens: 6348,
      outputTokens: 10,
      totalTokens: 6358,
    });

    // A provider that reports no cache detail must not grow a zeroed field.
    expect(
      extractOpenAITokenUsage({
        completion_tokens: 10,
        prompt_tokens: 6348,
        total_tokens: 6358,
      })
    ).toEqual({ inputTokens: 6348, outputTokens: 10, totalTokens: 6358 });
  });
});

describe("buildProviderHttpError", () => {
  test("maps a rejected API key to 400 so it is never reported as a server bug, keeping the provider's message", () => {
    const body = JSON.stringify({
      error: { message: "Incorrect API key provided." },
    });

    const error = buildProviderHttpError("OpenAI", 401, body);

    expect(error).toBeInstanceOf(NakamaApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe(formatHttpErrorBody("OpenAI", 401, body));
  });

  test("maps a 402 or 403 to 400 and every other provider failure to 502", () => {
    expect(buildProviderHttpError("OpenAI", 402, "").status).toBe(400);
    expect(buildProviderHttpError("OpenAI", 403, "").status).toBe(400);
    expect(buildProviderHttpError("OpenAI", 429, "").status).toBe(502);
    expect(buildProviderHttpError("OpenAI", 500, "").status).toBe(502);
  });

  test("maps an account refusal sent with another status to 400", () => {
    const quota = { code: "insufficient_quota", type: "insufficient_quota" };
    const rateLimit = { code: "rate_limit_exceeded", type: "requests" };

    // Raw HTTP bodies nest the error; OpenAI SDK errors arrive flat.
    expect(
      buildProviderHttpError("OpenAI", 429, JSON.stringify({ error: quota }))
        .status
    ).toBe(400);
    expect(
      buildProviderHttpError("OpenAI", 429, JSON.stringify(quota)).status
    ).toBe(400);
    expect(
      buildProviderHttpError(
        "OpenAI",
        429,
        JSON.stringify({ error: rateLimit })
      ).status
    ).toBe(502);
  });
});

describe("dropEmptyEnumMembers", () => {
  test("keeps usable members and drops empty or non-scalar ones", () => {
    expect(
      dropEmptyEnumMembers({
        enum: ["", "fast", null, { nested: true }, "slow"],
        type: "string",
      })
    ).toEqual({ enum: ["fast", "slow"], type: "string" });
  });

  test("drops an enum that has no usable member", () => {
    expect(dropEmptyEnumMembers({ enum: ["", null], type: "string" })).toEqual({
      type: "string",
    });
  });

  test("walks nested properties, arrays and items", () => {
    expect(
      dropEmptyEnumMembers({
        properties: {
          config: {
            properties: {
              trial: {
                properties: {
                  graduationStrategy: { enum: [""], type: "string" },
                },
                type: "object",
              },
            },
            type: "object",
          },
          modes: {
            items: { enum: ["", "fast"], type: "string" },
            type: "array",
          },
        },
        type: "object",
      })
    ).toEqual({
      properties: {
        config: {
          properties: {
            trial: {
              properties: { graduationStrategy: { type: "string" } },
              type: "object",
            },
          },
          type: "object",
        },
        modes: {
          items: { enum: ["fast"], type: "string" },
          type: "array",
        },
      },
      type: "object",
    });
  });

  test("does not mutate the input schema", () => {
    const input = { enum: ["", "fast"], type: "string" };

    dropEmptyEnumMembers(input);

    expect(input).toEqual({ enum: ["", "fast"], type: "string" });
  });
});
