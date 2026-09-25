import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { transcribeAudio } from "@nakama/core";
import type { ComposioService } from "./composio-service";

const exec = promisify(execFile);
const MAX_VIDEO_BYTES = 1024 ** 3;
const MAX_PART_BYTES = 24 * 1024 * 1024;

export async function cleanupInterruptedMeetImports() {
  for (const name of await readdir(tmpdir())) {
    const match = /^nakama-meet-(\d+)-/.exec(name);
    if (!match) {
      continue;
    }
    try {
      process.kill(Number(match[1]), 0);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        continue;
      }
    }
    await rm(join(tmpdir(), name), { force: true, recursive: true }).catch(
      () => {}
    );
  }
}

function fileSource(value: unknown): { url?: string; base64?: string } {
  if (typeof value === "string") {
    return value.startsWith("https://") ? { url: value } : { base64: value };
  }
  if (!value || typeof value !== "object") {
    return {};
  }
  const record = value as Record<string, unknown>;
  for (const child of [
    record.downloaded_file_content,
    record.file,
    record.data,
  ]) {
    const nested = fileSource(child);
    if (nested.url || nested.base64) {
      return nested;
    }
  }
  const pick = (keys: string[]) => {
    for (const key of keys) {
      if (typeof record[key] === "string") {
        return record[key] as string;
      }
    }
  };
  return {
    base64: pick(["base64", "content"]),
    url: pick(["url", "s3url", "s3Url", "downloadUrl", "fileUrl", "publicUrl"]),
  };
}

function safeDownloadUrl(raw: string): URL {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !(
      hostname === "storage.googleapis.com" ||
      hostname.endsWith(".amazonaws.com") ||
      hostname.endsWith(".composio.dev") ||
      hostname.endsWith(".composio.ai")
    )
  ) {
    throw new Error("Unsupported recording download location.");
  }
  return url;
}

async function saveDownload(value: unknown, path: string, signal: AbortSignal) {
  const source = fileSource(value);
  if (source.base64) {
    const encoded = source.base64.replace(/^data:[^,]+,/, "");
    if (encoded.length > Math.ceil(MAX_VIDEO_BYTES / 3) * 4) {
      throw new Error("Recording is too large.");
    }
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) {
      throw new Error("Invalid recording download.");
    }
    await Bun.write(path, bytes);
    return;
  }
  if (!source.url) {
    throw new Error("Composio returned no recording data.");
  }
  const url = safeDownloadUrl(source.url);
  const response = await fetch(url, { redirect: "error", signal });
  if (!(response.ok && response.body)) {
    throw new Error("Recording download failed.");
  }
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_VIDEO_BYTES) {
    throw new Error("Recording is too large.");
  }
  const writer = createWriteStream(path, { mode: 0o600 });
  let size = 0;
  try {
    for await (const chunk of response.body) {
      signal.throwIfAborted();
      size += chunk.byteLength;
      if (size > MAX_VIDEO_BYTES) {
        throw new Error("Recording is too large.");
      }
      if (!writer.write(chunk)) {
        await once(writer, "drain");
      }
    }
    writer.end();
    await once(writer, "finish");
    if (!size) {
      throw new Error("Recording download was empty.");
    }
  } catch (error) {
    writer.destroy();
    throw error;
  }
}

export async function importMeetRecording(
  composio: ComposioService,
  input: {
    orgId: string;
    userId: string;
    dataDir: string;
    messageId: string;
    fileId: string;
  },
  signal: AbortSignal
): Promise<{ filename: string; text: string }> {
  let settings: { apiKey?: unknown };
  try {
    settings = JSON.parse(
      readFileSync(join(input.dataDir, "settings.json"), "utf8")
    );
  } catch {
    throw new Error("Set an OpenAI key in Google Meet Settings first.");
  }
  if (typeof settings.apiKey !== "string" || !settings.apiKey.trim()) {
    throw new Error("Set an OpenAI key in Google Meet Settings first.");
  }
  const { recording, file } = await composio.downloadMeetRecording(
    input.orgId,
    input.userId,
    input.messageId,
    input.fileId
  );
  const directory = await mkdtemp(
    join(tmpdir(), `nakama-meet-${process.pid}-${randomUUID()}-`)
  );
  try {
    const video = join(directory, "recording");
    await saveDownload(file, video, signal);
    const { stdout } = await exec(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        video,
      ],
      { signal, timeout: 30_000 }
    );
    const duration = Number(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0 || duration > 7200) {
      throw new Error("Recording must be at most two hours.");
    }
    await exec(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        video,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "48k",
        "-f",
        "segment",
        "-segment_time",
        "1800",
        "-reset_timestamps",
        "1",
        join(directory, "part-%03d.mp3"),
      ],
      { maxBuffer: 1024 * 1024, signal, timeout: 600_000 }
    );
    const parts = (await readdir(directory))
      .filter((name) => /^part-\d+\.mp3$/.test(name))
      .sort();
    if (!parts.length) {
      throw new Error("No audio found in the recording.");
    }
    const transcript: string[] = [];
    for (const part of parts) {
      signal.throwIfAborted();
      const path = join(directory, part);
      const { size } = await stat(path);
      if (!size || size > MAX_PART_BYTES) {
        throw new Error("Converted audio part exceeds the Whisper limit.");
      }
      const text = await transcribeAudio({
        audio: {
          bytes: await readFile(path),
          filename: part,
          mediaType: "audio/mpeg",
        },
        model: "whisper-1",
        provider: { apiKey: settings.apiKey, type: "openai" },
        signal,
      });
      transcript.push(text);
    }
    return { filename: recording.name, text: transcript.join("\n\n") };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
