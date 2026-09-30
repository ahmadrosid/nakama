import { afterEach, describe, expect, mock, test } from "bun:test";
import { streamFromChunks } from "../test-helpers";
import { createAnthropicProvider } from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Anthropic provider streaming", () => {
  test("sends Opus 5.5 binding controls on streamed requests", async () => {
    const provider = createAnthropicProvider({
      apiKey: "sk-ant-test",
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("anthropic-beta")).toBe(
          "thinking-binding-controls-2026-08-01"
        );
        expect(JSON.parse(String(init?.body)).thinking).toEqual({
          block_binding: { prefix_mismatch_behavior: "drop_block" },
          type: "adaptive",
        });
        return new Response(
          streamFromChunks([
            'event: message_start\r\ndata:{"type":"message_start","message":{"usage":{"input_tokens":4}}}\r\n\r\n',
            'event: content_block_start\r\ndata:{"type":"content_block_start","index":0,"content_block":{"type":"text","text":"OK"}}\r\n\r\n',
            'event: message_delta\r\ndata:{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\r\n\r\n',
          ]),
          { headers: { "Content-Type": "text/event-stream" } }
        );
      }) as typeof fetch,
      model: "claude-opus-5-5",
    });
    const result = await provider.streamChat(
      { messages: [{ content: "Hello", role: "user" }], system: "Be helpful." },
      { onChunk: () => undefined }
    );
    expect(result.content).toBe("OK");
  });

  test("streams text deltas", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://api.anthropic.com/v1/messages");

      return new Response(
        streamFromChunks([
          'event: message_start\r\ndata:{"type":"message_start","message":{"usage":{"input_tokens":55}}}\r\n\r\n',
          'event: content_block_start\r\ndata:{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\r\n\r\n',
          'event: content_block_delta\r\ndata:{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\r\n\r\n',
          'event: content_block_delta\r\ndata:{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\r\n\r\n',
          'event: message_delta\r\ndata:{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":11}}\r\n\r\n',
        ]),
        { headers: { "Content-Type": "text/event-stream" }, status: 200 }
      );
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createAnthropicProvider({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
    });

    const chunks: string[] = [];
    const result = await provider.streamChat(
      {
        messages: [{ content: "Say hello", role: "user" }],
        system: "You are helpful.",
      },
      {
        onChunk: (delta) => chunks.push(delta),
      }
    );

    expect(result.content).toBe("Hello");
    expect(result.usage).toEqual({
      inputTokens: 55,
      outputTokens: 11,
      totalTokens: 66,
    });
    expect(chunks).toEqual(["Hel", "lo"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Anthropic cache buckets", () => {
  test("adds the cache buckets into input and keeps the read hit separate", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          streamFromChunks([
            'event: message_start\r\ndata:{"type":"message_start","message":{"usage":{"input_tokens":12,"cache_read_input_tokens":6144,"cache_creation_input_tokens":204}}}\r\n\r\n',
            'event: content_block_start\r\ndata:{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\r\n\r\n',
            'event: content_block_delta\r\ndata:{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\r\n\r\n',
            'event: message_delta\r\ndata:{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\r\n\r\n',
          ]),
          { headers: { "Content-Type": "text/event-stream" }, status: 200 }
        )
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = createAnthropicProvider({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
    });

    const result = await provider.streamChat(
      { messages: [{ content: "hi", role: "user" }], system: "s" },
      { onChunk: () => undefined }
    );

    // Anthropic excludes both cache buckets from input_tokens, so a reader that
    // takes input_tokens alone reports 12 instead of 6360.
    expect(result.usage).toEqual({
      cachedInputTokens: 6144,
      inputTokens: 6360,
      outputTokens: 7,
      totalTokens: 6367,
    });
  });
});
