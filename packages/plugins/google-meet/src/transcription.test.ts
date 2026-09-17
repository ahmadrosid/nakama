import { expect, test } from "bun:test";
import {
  OpenAITranscript,
  transcriptionConfig,
  transcriptionProviders,
} from "./transcription";

test("defaults to gpt-transcribe without inheriting a chat model", () => {
  expect(transcriptionConfig({ apiKey: "secret" })).toEqual({
    apiKey: "secret",
    model: "gpt-transcribe",
    provider: "openai",
  });
  expect(() =>
    transcriptionConfig({ apiKey: "secret", provider: "chatgpt" })
  ).toThrow();
});

test("orders asynchronous completions by committed audio turns and ignores duplicates", () => {
  const transcript = new OpenAITranscript();
  transcript.accept({
    item_id: "a",
    previous_item_id: null,
    type: "input_audio_buffer.committed",
  });
  transcript.accept({
    item_id: "b",
    previous_item_id: "a",
    type: "input_audio_buffer.committed",
  });
  transcript.accept({
    item_id: "b",
    transcript: "Second",
    type: "conversation.item.input_audio_transcription.completed",
  });
  expect(transcript.drain()).toEqual([]);
  transcript.accept({
    item_id: "a",
    transcript: "First",
    type: "conversation.item.input_audio_transcription.completed",
  });
  expect(transcript.drain().map((segment) => segment.text)).toEqual([
    "First",
    "Second",
  ]);
  transcript.accept({
    item_id: "a",
    transcript: "First",
    type: "conversation.item.input_audio_transcription.completed",
  });
  expect(transcript.drain()).toEqual([]);
});

test("propagates transcription failures instead of silently losing a turn", () => {
  const transcript = new OpenAITranscript();
  expect(() =>
    transcript.accept({
      error: { message: "secret upstream detail" },
      item_id: "a",
      type: "conversation.item.input_audio_transcription.failed",
    })
  ).toThrow("Transcription failed");
});

test("websocket sends PCM and flushes a VAD turn racing the final empty commit", async () => {
  const original = globalThis.WebSocket;
  const sent: Record<string, unknown>[] = [];
  const segments: string[] = [];
  let closed = false;
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    constructor(_url: string, options: Bun.WebSocketOptions) {
      super();
      expect(options.headers).toEqual({ Authorization: "Bearer test-key" });
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    emit(event: unknown) {
      this.dispatchEvent(
        new MessageEvent("message", { data: JSON.stringify(event) })
      );
    }
    send(data: string) {
      const event = JSON.parse(data);
      sent.push(event);
      if (event.type === "session.update") {
        queueMicrotask(() => this.emit({ type: "session.updated" }));
      }
      if (event.type === "input_audio_buffer.commit") {
        queueMicrotask(() => {
          this.emit({ item_id: "last", type: "input_audio_buffer.committed" });
          this.emit({
            error: { code: "input_audio_buffer_commit_empty" },
            type: "error",
          });
          this.emit({
            item_id: "last",
            transcript: "Final sentence",
            type: "conversation.item.input_audio_transcription.completed",
          });
        });
      }
    }
    close() {
      closed = true;
    }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  try {
    const session = await transcriptionProviders.openai!.connect({
      apiKey: "test-key",
      model: "gpt-transcribe",
      onError: (error) => {
        throw error;
      },
      onSegment: (segment) => segments.push(segment.text),
      signal: new AbortController().signal,
    });
    session.push(new Uint8Array([1, 2, 3, 4]));
    await session.finish();
    session.close();
    expect(sent[0]).toMatchObject({
      session: {
        audio: { input: { transcription: { model: "gpt-transcribe" } } },
        type: "transcription",
      },
    });
    expect(sent[1]).toEqual({
      audio: "AQIDBA==",
      type: "input_audio_buffer.append",
    });
    expect(segments).toEqual(["Final sentence"]);
    expect(closed).toBe(true);
  } finally {
    globalThis.WebSocket = original;
  }
});

test("cancelling a connecting provider releases the socket immediately", async () => {
  const original = globalThis.WebSocket;
  let closed = false;
  class Socket extends EventTarget {
    close() {
      closed = true;
    }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  const abort = new AbortController();
  try {
    const pending = transcriptionProviders.openai!.connect({
      apiKey: "test",
      model: "gpt-transcribe",
      onError() {},
      onSegment() {},
      signal: abort.signal,
    });
    abort.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(closed).toBe(true);
  } finally {
    globalThis.WebSocket = original;
  }
});
