import { afterEach, describe, expect, mock, test } from "bun:test";
import { createAnthropicProvider } from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

describe("Anthropic provider streaming", () => {
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
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
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
        system: "You are helpful.",
        messages: [{ role: "user", content: "Say hello" }],
      },
      {
        onChunk: (delta) => chunks.push(delta),
      },
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
