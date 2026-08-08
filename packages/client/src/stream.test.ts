import { describe, expect, test } from "bun:test";
import { readStreamEvents } from "./stream";

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

describe("readStreamEvents", () => {
  test("ignores SSE comment keepalive lines", async () => {
    await expect(
      readStreamEvents(
        streamFromChunks([
          ": ping\n\n",
          ": ping\n\n",
          'data: {"type":"done","reply":"ok"}\n\n',
        ]),
        { onChunk: () => {} }
      )
    ).resolves.toBe("ok");
  });

  test("throws a helpful error when only keepalive comments arrive", async () => {
    await expect(
      readStreamEvents(streamFromChunks([": ping\n\n", ": ping\n\n"]), {
        onChunk: () => {},
      })
    ).rejects.toThrow("Only server keepalive events were received");
  });

  test("dispatches tool_input_delta events", async () => {
    const deltas: Array<{
      toolCallId: string;
      delta: string;
      accumulatedArguments?: string;
    }> = [];

    await readStreamEvents(
      streamFromChunks([
        'data: {"type":"tool_input_delta","toolCallId":"call_1","tool":"write_file","delta":"{\\"path\\"","accumulatedArguments":"{\\"path\\""}\n\n',
        'data: {"type":"done","reply":"ok"}\n\n',
      ]),
      {
        onChunk: () => {},
        onToolInputDelta: (event) => {
          deltas.push({
            accumulatedArguments: event.accumulatedArguments,
            delta: event.delta,
            toolCallId: event.toolCallId,
          });
        },
      }
    );

    expect(deltas).toEqual([
      {
        accumulatedArguments: '{"path"',
        delta: '{"path"',
        toolCallId: "call_1",
      },
    ]);
  });

  test("dispatches sub_agent_activity events", async () => {
    const events: Array<{ parentToolCallId: string; label: string }> = [];

    await readStreamEvents(
      streamFromChunks([
        'data: {"type":"sub_agent_activity","parentToolCallId":"call_sa","label":"Reading SOUL.md"}\n\n',
        'data: {"type":"done","reply":"ok"}\n\n',
      ]),
      {
        onChunk: () => {},
        onSubAgentActivity: (event) => {
          events.push(event);
        },
      }
    );

    expect(events).toEqual([
      { label: "Reading SOUL.md", parentToolCallId: "call_sa" },
    ]);
  });

  test("dispatches contextUsage from done events", async () => {
    const usages: Array<{ usedTokens: number; source: string }> = [];

    await readStreamEvents(
      streamFromChunks([
        'data: {"type":"done","reply":"ok","contextUsage":{"usedTokens":1200,"usableContextTokens":180000,"contextWindow":200000,"source":"provider"}}\n\n',
      ]),
      {
        onChunk: () => {},
        onContextUsage: (usage) => {
          usages.push({ source: usage.source, usedTokens: usage.usedTokens });
        },
      }
    );

    expect(usages).toEqual([{ source: "provider", usedTokens: 1200 }]);
  });

  test("surfaces server error events", async () => {
    await expect(
      readStreamEvents(
        streamFromChunks([
          'data: {"type":"error","error":"OpenCode Zen request failed (429 FreeUsageLimitError): Rate limit exceeded."}\n\n',
        ]),
        { onChunk: () => {} }
      )
    ).rejects.toThrow("Rate limit exceeded");
  });
});
