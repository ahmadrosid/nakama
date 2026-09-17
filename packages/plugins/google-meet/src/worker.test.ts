import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateJson } from "./actions";
import { MeetingStore } from "./store";
import { transcriptionProviders } from "./transcription";
import { runMeeting } from "./worker";

test("worker captures PCM, flushes final speech, releases capture and persists completion", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meet-worker-"));
  const store = new MeetingStore(dir, "org");
  const provider = transcriptionProviders.openai!;
  let closed = false;
  let providerClosed = false;
  let bytes = 0;
  try {
    privateJson(join(dir, "settings.json"), { apiKey: "test" });
    const meeting = store.create(
      "https://meet.google.com/abc-defg-hij",
      "user",
      undefined,
      1
    );
    transcriptionProviders.openai = {
      async connect({ onSegment }) {
        return {
          close() {
            providerClosed = true;
          },
          async finish() {
            onSegment({ id: "last", receivedAt: 123, text: "Final words" });
          },
          push(audio) {
            bytes += audio.length;
          },
        };
      },
    };
    await runMeeting(
      meeting,
      store,
      dir,
      new AbortController().signal,
      async ({ signal }) => ({
        audio: new ReadableStream<Uint8Array<ArrayBuffer>>({
          start(controller) {
            controller.enqueue(new Uint8Array(4801));
            store.stop(meeting.id);
            signal.addEventListener("abort", () => controller.close(), {
              once: true,
            });
          },
        }),
        async close() {
          closed = true;
        },
        async inCall() {
          return true;
        },
      })
    );
    expect(bytes).toBe(4800);
    expect(closed && providerClosed).toBe(true);
    expect(store.get(meeting.id)?.state).toBe("finished");
    expect(store.transcript(meeting.id).map((segment) => segment.text)).toEqual(
      ["Final words"]
    );
  } finally {
    transcriptionProviders.openai = provider;
    store.close();
    rmSync(dir, { force: true, recursive: true });
  }
});

test("capture failure is terminal and another meeting can be queued", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meet-worker-"));
  const store = new MeetingStore(dir, "org");
  try {
    privateJson(join(dir, "settings.json"), { apiKey: "test" });
    const meeting = store.create(
      "https://meet.google.com/abc-defg-hij",
      "user",
      undefined,
      1
    );
    await runMeeting(meeting, store, dir, new AbortController().signal, () =>
      Promise.reject(new Error("Admission denied"))
    );
    expect(store.get(meeting.id)?.state).toBe("failed");
    expect(store.create(meeting.url, "user", undefined, 1).state).toBe(
      "queued"
    );
  } finally {
    store.close();
    rmSync(dir, { force: true, recursive: true });
  }
});
