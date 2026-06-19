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
        { onChunk: () => {} },
      ),
    ).resolves.toBe("ok");
  });

  test("throws a helpful error when only keepalive comments arrive", async () => {
    await expect(
      readStreamEvents(
        streamFromChunks([": ping\n\n", ": ping\n\n"]),
        { onChunk: () => {} },
      ),
    ).rejects.toThrow("Only server keepalive events were received");
  });

  test("surfaces server error events", async () => {
    await expect(
      readStreamEvents(
        streamFromChunks([
          'data: {"type":"error","error":"OpenCode Zen request failed (429 FreeUsageLimitError): Rate limit exceeded."}\n\n',
        ]),
        { onChunk: () => {} },
      ),
    ).rejects.toThrow("Rate limit exceeded");
  });
});
