import { describe, expect, test } from "bun:test";
import { streamFromChunks } from "../test-helpers";
import { createAnthropicProvider } from "./index";

// Anthropic answers `pause_turn` when a server-side tool needs another round
// trip. Each one costs a billed request, so the loop in `web-search.ts` is
// bounded and falls through to a normal result when the bound is reached.
const EXPECTED_CONTINUATIONS = 5;

function pausedStream(): Response {
  return new Response(
    streamFromChunks([
      'event: message_start\r\ndata:{"type":"message_start","message":{"usage":{"input_tokens":10}}}\r\n\r\n',
      'event: content_block_start\r\ndata:{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\r\n\r\n',
      'event: content_block_delta\r\ndata:{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"step"}}\r\n\r\n',
      'event: content_block_stop\r\ndata:{"type":"content_block_stop","index":0}\r\n\r\n',
      'event: message_delta\r\ndata:{"type":"message_delta","delta":{"stop_reason":"pause_turn"},"usage":{"output_tokens":2}}\r\n\r\n',
    ]),
    { headers: { "Content-Type": "text/event-stream" } }
  );
}

function pausedPayload(): Response {
  return Response.json({
    content: [{ text: "step", type: "text" }],
    stop_reason: "pause_turn",
    usage: { input_tokens: 10, output_tokens: 2 },
  });
}

describe("Anthropic pause_turn continuations", () => {
  for (const stream of [false, true]) {
    test(`stop at the continuation cap and keep the result (stream=${stream})`, async () => {
      let calls = 0;

      const provider = createAnthropicProvider({
        apiKey: "sk-ant-test",
        fetch: async () => {
          calls += 1;

          return stream ? pausedStream() : pausedPayload();
        },
        model: "claude-sonnet-5-5",
      });

      const input = {
        messages: [{ content: "Search", role: "user" as const }],
        system: "Be brief.",
      };

      const chunks: string[] = [];

      const result = stream
        ? await provider.streamChat(input, {
            onChunk: (delta: string) => chunks.push(delta),
          })
        : await provider.generateChat(input);

      // The bound is the point: a provider that never stops pausing must not
      // turn one chat turn into an unbounded number of billed requests.
      expect(calls).toBe(EXPECTED_CONTINUATIONS);

      // Reaching the bound returns what was gathered rather than throwing, so
      // the user keeps the partial answer.
      expect(result.content).toBe("step".repeat(EXPECTED_CONTINUATIONS));

      // Usage is summed over every round, which is what the organization is
      // billed for and what the quota ledger reads.
      expect(result.usage?.inputTokens).toBe(10 * EXPECTED_CONTINUATIONS);
      expect(result.usage?.outputTokens).toBe(2 * EXPECTED_CONTINUATIONS);

      if (stream) {
        expect(chunks).toEqual(
          Array.from({ length: EXPECTED_CONTINUATIONS }, () => "step")
        );
      }
    });
  }
});
