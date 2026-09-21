import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateJson } from "./actions";
import { MeetingStore } from "./store";
import { transcriptionProviders } from "./transcription";
import {
  captureSession,
  createStreamMeeting,
  generateNextMeetingTitle,
} from "./worker";

test.each([true, false])(
  "saved meetings get a persistent title with API success=%s",
  async (success) => {
    const directory = mkdtempSync(join(tmpdir(), "meet-title-"));
    const store = new MeetingStore(directory, "org");
    const request = spyOn(globalThis, "fetch").mockImplementation(
      async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        expect(body.messages[1].content).toContain("Plan the September launch");
        return success
          ? Response.json({
              choices: [{ message: { content: "September Launch Plan" } }],
            })
          : new Response(null, { status: 503 });
      }
    );
    try {
      privateJson(join(directory, "settings.json"), { apiKey: "test" });
      const meeting = store.create(
        "https://meet.google.com/abc-defg-hij",
        "user",
        undefined,
        1
      );
      store.addSegment(meeting.id, {
        id: "one",
        receivedAt: 1,
        text: "Plan the September launch",
      });
      await generateNextMeetingTitle(
        store,
        directory,
        new AbortController().signal
      );
      expect(request).not.toHaveBeenCalled();
      store.update(meeting.id, "finished");
      await generateNextMeetingTitle(
        store,
        directory,
        new AbortController().signal
      );
      await generateNextMeetingTitle(
        store,
        directory,
        new AbortController().signal
      );
      expect(request).toHaveBeenCalledTimes(1);
      expect(store.list()[0]?.title).toBe(
        success ? "September Launch Plan" : "Plan the September launch"
      );
      expect(store.get(meeting.id)?.state).toBe("finished");
      expect(store.transcript(meeting.id)[0]?.text).toBe(
        "Plan the September launch"
      );
      const reopened = new MeetingStore(directory, "org");
      try {
        expect(reopened.get(meeting.id)?.title).toBe(
          store.get(meeting.id)?.title
        );
      } finally {
        reopened.close();
      }
    } finally {
      request.mockRestore();
      store.close();
      rmSync(directory, { force: true, recursive: true });
    }
  }
);

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

test("Stop acknowledges captured audio while final transcription drains and rejects late frames", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meet-drain-"));
  const store = new MeetingStore(directory, "org");
  const provider = transcriptionProviders.openai!;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finishes = 0;
  try {
    privateJson(join(directory, "settings.json"), { apiKey: "test" });
    const meeting = store.create(
      "https://meet.google.com/abc-defg-hij",
      "user",
      undefined,
      1
    );
    transcriptionProviders.openai = {
      async connect({ onSegment }) {
        return {
          close() {},
          async finish() {
            finishes++;
            await pending;
            onSegment({
              id: "last",
              receivedAt: 1,
              speakerName: "Speaker 1",
              text: "Final words",
            });
          },
          push() {},
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
    expect(store.get(meeting.id)?.state).toBe("recording");
    await stream.push(new Uint8Array(256));
    const done = stream.close(true);
    await stream.captured();
    await Bun.sleep(0);
    expect(store.get(meeting.id)?.state).toBe("transcribing");
    await expect(stream.push(new Uint8Array(256))).rejects.toThrow();
    release();
    await done;
    await stream.close(false);
    expect(finishes).toBe(1);
    expect(store.get(meeting.id)?.state).toBe("finished");
    expect(store.transcript(meeting.id)[0]?.text).toBe("Final words");
  } finally {
    release();
    transcriptionProviders.openai = provider;
    store.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
