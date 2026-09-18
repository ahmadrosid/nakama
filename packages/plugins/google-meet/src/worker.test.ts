import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateJson } from "./actions";
import { MeetingStore } from "./store";
import { transcriptionProviders } from "./transcription";
import { captureSession, createStreamMeeting } from "./worker";

test("streams PCM frames to OpenAI and persists the final transcript", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meet-stream-"));
  const store = new MeetingStore(directory, "org");
  const provider = transcriptionProviders.openai!;
  try {
    privateJson(join(directory, "settings.json"), { apiKey: "test" });
    const meeting = store.create(
      "https://meet.google.com/abc-defg-hij",
      "user",
      undefined,
      1
    );
    const frames: Uint8Array[] = [];
    transcriptionProviders.openai = {
      async connect({ onSegment }) {
        return {
          close() {},
          async finish() {
            onSegment({
              id: "segment-1",
              receivedAt: Date.now(),
              text: "Hello from Meet",
            });
          },
          push(audio) {
            frames.push(audio);
          },
        };
      },
    };
    const stream = createStreamMeeting(
      meeting,
      store,
      directory,
      new AbortController().signal
    );
    await stream.ready;
    await stream.push(new Uint8Array(4800));
    await stream.close(true);
    await stream.close(true);
    expect(frames).toHaveLength(1);
    expect(store.get(meeting.id)?.state).toBe("finished");
    expect(store.transcript(meeting.id).map((segment) => segment.text)).toEqual(
      ["Hello from Meet"]
    );
  } finally {
    transcriptionProviders.openai = provider;
    store.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("capture sessions ignore missing or malformed files", () => {
  const directory = mkdtempSync(join(tmpdir(), "meet-session-"));
  try {
    expect(captureSession(directory)).toBeUndefined();
    privateJson(join(directory, "capture.json"), {
      expiresAt: 1,
      meetingId: "meeting",
      token: "token",
    });
    expect(captureSession(directory)).toMatchObject({
      meetingId: "meeting",
      token: "token",
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
