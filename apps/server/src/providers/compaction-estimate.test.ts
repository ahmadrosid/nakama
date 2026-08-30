import { describe, expect, mock, test } from "bun:test";
// estimateHistoryTokens is not exported from @nakama/agent, hence the deep path.
import { estimateHistoryTokens } from "../../../../packages/agent/src/history-compaction";
import { createAnthropicProvider, toAnthropicMessages } from "./anthropic";

const j = (value: unknown) => JSON.stringify(value);
const ev = (payload: { type: string }) =>
  `event: ${payload.type}\r\ndata:${j(payload)}\r\n\r\n`;

// Mirrors TOKEN_ESTIMATE_RATIO = 4 in history-compaction.ts.
const estimateTokens = (text: string) => Math.ceil(text.length / 4);

function eventStream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" }, status: 200 }
  );
}

function streamOf(options: { text: string; thinking?: string }): string[] {
  const chunks = [
    'event: message_start\r\ndata:{"type":"message_start","message":{"usage":{"input_tokens":10}}}\r\n\r\n',
  ];
  let index = 0;

  if (options.thinking) {
    chunks.push(
      ev({
        content_block: { signature: "", thinking: "", type: "thinking" },
        index,
        type: "content_block_start",
      }),
      ev({
        delta: { thinking: options.thinking, type: "thinking_delta" },
        index,
        type: "content_block_delta",
      }),
      ev({
        delta: {
          signature: "EqQBCgIYAhIB0aBcd1234SIG",
          type: "signature_delta",
        },
        index,
        type: "content_block_delta",
      }),
      ev({ index, type: "content_block_stop" })
    );
    index += 1;
  }

  chunks.push(
    ev({
      content_block: { text: "", type: "text" },
      index,
      type: "content_block_start",
    }),
    ev({
      delta: { text: options.text, type: "text_delta" },
      index,
      type: "content_block_delta",
    }),
    ev({ index, type: "content_block_stop" }),
    'event: message_delta\r\ndata:{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":40}}\r\n\r\n'
  );

  return chunks;
}

async function ratioFor(options: { text: string; thinking?: string }) {
  const fetchMock = mock(async () => eventStream(streamOf(options)));
  const provider = createAnthropicProvider({
    apiKey: "sk-ant-test",
    fetch: fetchMock as unknown as typeof fetch,
    model: "claude-sonnet-4-6",
  });

  const user = { content: "invoices last quarter", role: "user" } as const;
  const { assistantMessage } = await provider.streamChat(
    { messages: [user], system: "s" },
    { onChunk: () => undefined }
  );

  const estimated =
    estimateHistoryTokens([user, assistantMessage], "", []) -
    estimateHistoryTokens([user], "", []);
  const sent =
    estimateTokens(j(await toAnthropicMessages([user, assistantMessage]))) -
    estimateTokens(j(await toAnthropicMessages([user])));

  return { estimated, ratio: estimated / sent, sent };
}

const LONG_TEXT = "Here is what I found in the invoice table. ".repeat(20);
const LONG_THINKING = "The user wants last quarter invoices. ".repeat(20);

describe("history token estimate", () => {
  test("does not over-count an assistant turn without thinking", async () => {
    const { estimated, ratio, sent } = await ratioFor({ text: LONG_TEXT });
    expect({ estimated, sent, within10Percent: ratio <= 1.1 }).toEqual({
      estimated,
      sent,
      within10Percent: true,
    });
  });

  test("does not under-count an assistant turn with thinking", async () => {
    const { estimated, ratio, sent } = await ratioFor({
      text: "Let me look that up.",
      thinking: LONG_THINKING,
    });
    expect({ estimated, sent, within10Percent: ratio >= 0.9 }).toEqual({
      estimated,
      sent,
      within10Percent: true,
    });
  });
});
