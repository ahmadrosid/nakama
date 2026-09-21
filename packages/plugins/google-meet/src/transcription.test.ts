import { expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatTranscript, type TranscriptSegment } from "./transcript-format";
import { transcriptionConfig, transcriptionProviders } from "./transcription";

test("legacy settings resolve to diarization without inheriting a chat model", () => {
  expect(
    transcriptionConfig({ apiKey: " secret ", model: "gpt-transcribe" })
  ).toEqual({
    apiKey: "secret",
    model: "gpt-4o-transcribe-diarize",
    provider: "openai",
  });
  expect(() =>
    transcriptionConfig({ apiKey: "secret", model: "gpt-4.1" })
  ).toThrow();
  expect(() => transcriptionConfig({ apiKey: " " })).toThrow();
});

test("speaker exports preserve imports and historical unlabelled text", () => {
  expect(
    formatTranscript([
      { speakerName: "Speaker 1", text: "hello" },
      { speakerName: "Speaker 2", text: "hi" },
    ])
  ).toBe("Speaker 1: hello\nSpeaker 2: hi\n");
  expect(formatTranscript([{ text: "  hello\n\n" }], true)).toBe("  hello\n\n");
  expect(formatTranscript([{ text: "old" }])).toBe("old\n");
});

test("publishes before Stop, captures while request is pending, and reuses voice references", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meet-diarize-"));
  const audioDir = join(directory, "audio");
  const segments: TranscriptSegment[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  const request = spyOn(globalThis, "fetch").mockImplementation(
    async (_url, init) => {
      const form = init!.body as FormData;
      expect(form.get("model")).toBe("gpt-4o-transcribe-diarize");
      expect(form.get("response_format")).toBe("diarized_json");
      const file = form.get("file") as File;
      const bytes = Buffer.from(await file.arrayBuffer());
      expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
      const call = requests++;
      if (call === 0) {
        expect(bytes.length).toBe(720_044);
        expect(form.getAll("known_speaker_names[]")).toEqual([]);
        await pending;
      } else {
        expect(form.getAll("known_speaker_names[]")).toEqual(["speaker_1"]);
        expect(String(form.get("known_speaker_references[]"))).toStartWith(
          "data:audio/wav;base64,"
        );
      }
      return Response.json({
        segments: [
          {
            end: 3,
            speaker: call === 0 ? "A" : "speaker_1",
            start: 0,
            text: `turn ${call}`,
          },
        ],
      });
    }
  );
  const session = await transcriptionProviders.openai!.connect({
    ...transcriptionConfig({ apiKey: "test" }),
    directory: audioDir,
    onError: () => {},
    onSegment: (segment) => segments.push(segment),
    signal: new AbortController().signal,
  });
  try {
    session.push(new Uint8Array(720_000));
    await Bun.sleep(5);
    session.push(new Uint8Array(144_000));
    expect(readdirSync(audioDir)).toHaveLength(2);
    expect(segments).toHaveLength(0);
    release();
    for (let i = 0; i < 100 && !segments.length; i++) {
      await Bun.sleep(1);
    }
    expect(segments).toHaveLength(1);
    expect(segments[0]?.speakerName).toBe("Speaker 1");
    await session.finish();
    await session.finish();
    expect(
      segments.map((segment) => [
        segment.id,
        segment.speakerId,
        segment.startMs,
      ])
    ).toEqual([
      ["0-0", "speaker_1", 0],
      ["1-0", "speaker_1", 15_000],
    ]);
    expect(requests).toBe(2);
    expect(() => session.push(new Uint8Array(2))).toThrow();
  } finally {
    release();
    await session.close();
    await Bun.sleep(0);
    request.mockRestore();
    expect(existsSync(audioDir)).toBe(false);
    rmSync(directory, { force: true, recursive: true });
  }
});

test("reused anonymous labels across chunks do not merge voices and invalid responses fail", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meet-speakers-"));
  const segments: TranscriptSegment[] = [];
  const failures: Error[] = [];
  let calls = 0;
  const request = spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json({
      segments: [
        { end: ++calls === 3 ? -1 : 1, speaker: "A", start: 0, text: "hello" },
      ],
    })
  );
  const session = await transcriptionProviders.openai!.connect({
    ...transcriptionConfig({ apiKey: "test" }),
    directory: join(directory, "audio"),
    onError: (error) => failures.push(error),
    onSegment: (segment) => segments.push(segment),
    signal: new AbortController().signal,
  });
  try {
    session.push(new Uint8Array(720_000 * 3));
    await expect(session.finish()).rejects.toThrow();
    expect(segments.map((segment) => segment.speakerId)).toEqual([
      "speaker_1",
      "speaker_2",
    ]);
    expect(failures).toHaveLength(1);
  } finally {
    await session.close();
    await Bun.sleep(0);
    request.mockRestore();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("permanent provider errors are not retried and queued audio is cleaned", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meet-error-"));
  const request = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 401 })
  );
  const session = await transcriptionProviders.openai!.connect({
    ...transcriptionConfig({ apiKey: "test" }),
    directory: join(directory, "audio"),
    onError: () => {},
    onSegment: () => {},
    signal: new AbortController().signal,
  });
  try {
    expect(() => session.push(new Uint8Array(1))).toThrow();
    expect(() => session.push(new Uint8Array(301 * 48_000))).toThrow();
    session.push(new Uint8Array(144_000));
    await expect(session.finish()).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  } finally {
    await session.close();
    await Bun.sleep(0);
    request.mockRestore();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("reference bank stays at four voices and retries do not duplicate turns", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meet-refs-"));
  const segments: TranscriptSegment[] = [];
  let calls = 0;
  const request = spyOn(globalThis, "fetch").mockImplementation(
    async (_url, init) => {
      calls++;
      if (calls === 1) {
        return new Response(null, { status: 503 });
      }
      if (calls === 2) {
        return Response.json({
          segments: ["A", "B", "C", "D", "E"].map((speaker, i) => ({
            end: i * 2 + 2,
            speaker,
            start: i * 2,
            text: speaker,
          })),
        });
      }
      const form = init!.body as FormData;
      expect(form.getAll("known_speaker_names[]")).toEqual([
        "speaker_1",
        "speaker_2",
        "speaker_3",
        "speaker_4",
      ]);
      expect(form.getAll("known_speaker_references[]")).toHaveLength(4);
      return Response.json({
        segments: [{ end: 2, speaker: "E", start: 0, text: "again" }],
      });
    }
  );
  const session = await transcriptionProviders.openai!.connect({
    ...transcriptionConfig({ apiKey: "test" }),
    directory: join(directory, "audio"),
    onError: () => {},
    onSegment: (segment) => segments.push(segment),
    signal: new AbortController().signal,
  });
  try {
    session.push(new Uint8Array(720_000 + 96_000));
    await session.finish();
    expect(calls).toBe(3);
    expect(segments).toHaveLength(6);
    expect(segments.at(-1)?.speakerId).toBe("speaker_6");
  } finally {
    await session.close();
    request.mockRestore();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("aborting an upload publishes no late segments and removes audio", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meet-abort-"));
  const audioDirectory = join(directory, "audio");
  const abort = new AbortController();
  const segments: TranscriptSegment[] = [];
  const request = spyOn(globalThis, "fetch").mockImplementation(
    async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener(
          "abort",
          () => reject(new Error("cancelled")),
          { once: true }
        );
      })
  );
  const session = await transcriptionProviders.openai!.connect({
    ...transcriptionConfig({ apiKey: "test" }),
    directory: audioDirectory,
    onError: () => {},
    onSegment: (segment) => segments.push(segment),
    signal: abort.signal,
  });
  try {
    session.push(new Uint8Array(720_000));
    await Bun.sleep(0);
    abort.abort();
    await expect(session.finish()).rejects.toThrow();
    await session.close();
    expect(segments).toHaveLength(0);
    expect(existsSync(audioDirectory)).toBe(false);
  } finally {
    await session.close();
    request.mockRestore();
    rmSync(directory, { force: true, recursive: true });
  }
});
