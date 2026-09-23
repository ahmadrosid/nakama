import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ComposioService } from "./composio-service";
import { importMeetRecording } from "./meet-recording-import";

test("recorded video becomes a Whisper transcript and temporary media is removed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meet-import-test-"));
  const before = (await readdir(tmpdir())).filter((name) =>
    name.startsWith("nakama-meet-")
  );
  const originalFetch = globalThis.fetch;
  try {
    const video = join(directory, "meeting.mp4");
    await promisify(execFile)("ffmpeg", [
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:d=1",
      "-shortest",
      "-c:v",
      "mpeg4",
      "-c:a",
      "aac",
      video,
    ]);
    await writeFile(
      join(directory, "settings.json"),
      JSON.stringify({ apiKey: "test-key" })
    );
    const composio = {
      async downloadMeetRecording() {
        return {
          file: { base64: (await readFile(video)).toString("base64") },
          recording: { name: "Sprint.mp4" },
        };
      },
    } as unknown as ComposioService;
    let requests = 0;
    globalThis.fetch = (async (_url, options) => {
      requests += 1;
      const form = options?.body as FormData;
      expect(form.get("model")).toBe("whisper-1");
      expect((form.get("file") as File).name).toMatch(/\.mp3$/);
      return new Response(JSON.stringify({ text: "Sprint decision" }), {
        status: 200,
      });
    }) as typeof fetch;
    const result = await importMeetRecording(
      composio,
      {
        dataDir: directory,
        fileId: "drive_file_123",
        messageId: "msg_1",
        orgId: "org",
        userId: "member",
      },
      new AbortController().signal
    );
    expect(result).toEqual({ filename: "Sprint.mp4", text: "Sprint decision" });
    expect(requests).toBe(1);
    const after = (await readdir(tmpdir())).filter((name) =>
      name.startsWith("nakama-meet-")
    );
    expect(after).toEqual(before);
    await expect(
      importMeetRecording(
        {
          async downloadMeetRecording() {
            return {
              file: { url: "http://127.0.0.1/private" },
              recording: { name: "Bad.mp4" },
            };
          },
        } as unknown as ComposioService,
        {
          dataDir: directory,
          fileId: "drive_file_123",
          messageId: "msg_1",
          orgId: "org",
          userId: "member",
        },
        new AbortController().signal
      )
    ).rejects.toThrow("Unsupported recording download location");
    globalThis.fetch = (async () =>
      new Response("{}", { status: 500 })) as typeof fetch;
    await expect(
      importMeetRecording(
        composio,
        {
          dataDir: directory,
          fileId: "drive_file_123",
          messageId: "msg_1",
          orgId: "org",
          userId: "member",
        },
        new AbortController().signal
      )
    ).rejects.toThrow("Audio transcription failed");
    expect(
      (await readdir(tmpdir())).filter((name) =>
        name.startsWith("nakama-meet-")
      )
    ).toEqual(before);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { force: true, recursive: true });
  }
});
