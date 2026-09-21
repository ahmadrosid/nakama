import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { TranscriptSegment } from "./transcript-format";

export interface TranscriptionSession {
  close(): void | Promise<void>;
  finish(): Promise<void>;
  push(audio: Uint8Array): void;
}

export interface TranscriptionProvider {
  connect(options: {
    apiKey: string;
    model: string;
    directory: string;
    signal: AbortSignal;
    onSegment(segment: TranscriptSegment): void;
    onError(error: Error): void;
    onProgress?(seconds: number): void;
  }): Promise<TranscriptionSession>;
}

export function transcriptionConfig(value: Record<string, unknown>) {
  const provider = value.provider ?? "openai";
  if (
    provider !== "openai" ||
    (value.model != null &&
      !["gpt-transcribe", "gpt-4o-transcribe-diarize"].includes(
        String(value.model)
      ))
  ) {
    throw new Error("Unsupported transcription provider or model");
  }
  if (
    typeof value.apiKey !== "string" ||
    !value.apiKey.trim() ||
    value.apiKey.length > 4096
  ) {
    throw new Error("An OpenAI API key is required for transcription");
  }
  return {
    apiKey: value.apiKey.trim(),
    model: "gpt-4o-transcribe-diarize",
    provider,
  };
}

const BYTES_PER_SECOND = 48_000;
const CHUNK_BYTES = 15 * BYTES_PER_SECOND;

function wav(pcm: Uint8Array) {
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24_000, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

interface Turn {
  end: number;
  speaker: string | null;
  start: number;
  text: string;
}
function parseTurns(value: unknown, duration: number): Turn[] {
  const segments = (value as { segments?: unknown })?.segments;
  if (!Array.isArray(segments) || segments.length > 2000) {
    throw new Error("Invalid transcription segments");
  }
  return segments
    .map((segment) => {
      if (
        !segment ||
        typeof segment.text !== "string" ||
        segment.text.length > 32_000 ||
        !Number.isFinite(segment.start) ||
        !Number.isFinite(segment.end) ||
        segment.start < 0 ||
        segment.end < segment.start ||
        segment.start > duration ||
        segment.end > duration + 0.1 ||
        (segment.speaker != null &&
          (typeof segment.speaker !== "string" || segment.speaker.length > 128))
      ) {
        throw new Error("Invalid transcription segment");
      }
      return {
        end: Math.min(segment.end, duration),
        speaker: segment.speaker || null,
        start: segment.start,
        text: segment.text,
      };
    })
    .sort((a, b) => a.start - b.start);
}

const openai: TranscriptionProvider = {
  async connect({
    apiKey,
    model,
    directory,
    signal,
    onSegment,
    onError,
    onProgress,
  }) {
    signal.throwIfAborted();
    mkdirSync(directory, { mode: 0o700, recursive: true });
    const abort = new AbortController();
    const combined = AbortSignal.any([signal, abort.signal]);
    // ponytail: four provider reference slots; add explicit speaker assignment if larger meetings need continuity.
    const refs = new Map<string, string>();
    let speakerCount = 0;
    let chunkIndex = 0;
    let bytes = 0;
    let offset = 0;
    let pendingBytes = 0;
    let queue = Promise.resolve();
    let failure: Error | undefined;
    let finished = false;
    let closed = false;
    const path = () => join(directory, `${chunkIndex}.pcm`);
    const fail = (error: unknown) => {
      if (!failure) {
        failure =
          error instanceof Error ? error : new Error("Transcription failed");
        onError(failure);
      }
    };
    async function transcribe(
      file: string,
      index: number,
      start: number,
      length: number
    ) {
      combined.throwIfAborted();
      const pcm = readFileSync(file);
      const form = new FormData();
      form.set("file", new Blob([wav(pcm)]), "meeting.wav");
      form.set("model", model);
      form.set("response_format", "diarized_json");
      form.set("chunking_strategy", "auto");
      for (const [name, reference] of refs) {
        form.append("known_speaker_names[]", name);
        form.append("known_speaker_references[]", reference);
      }
      let turns: Turn[] | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        let response: Response;
        try {
          response = await fetch(
            "https://api.openai.com/v1/audio/transcriptions",
            {
              body: form,
              headers: { Authorization: `Bearer ${apiKey}` },
              method: "POST",
              signal: AbortSignal.any([combined, AbortSignal.timeout(60_000)]),
            }
          );
        } catch (error) {
          if (combined.aborted || attempt === 2) {
            throw error;
          }
          await Bun.sleep(250 * (attempt + 1));
          continue;
        }
        if (response.ok) {
          turns = parseTurns(await response.json(), length / BYTES_PER_SECOND);
          break;
        }
        await response.body?.cancel();
        if (response.status !== 429 && response.status < 500) {
          throw new Error(`Transcription request failed (${response.status})`);
        }
        if (attempt < 2) {
          await Bun.sleep(250 * (attempt + 1));
        }
      }
      if (!turns) {
        throw new Error(
          "Transcription temporarily unavailable; partial transcript saved"
        );
      }
      combined.throwIfAborted();
      const names = new Map<string, string>();
      for (const turn of turns) {
        if (turn.speaker && !names.has(turn.speaker)) {
          names.set(
            turn.speaker,
            refs.has(turn.speaker) ? turn.speaker : `speaker_${++speakerCount}`
          );
        }
      }
      for (const [label, id] of names) {
        if (refs.size >= 4 || refs.has(id)) {
          continue;
        }
        const sample = turns
          .filter(
            (turn) =>
              turn.speaker === label &&
              turn.end - turn.start >= 2 &&
              !turns.some(
                (other) =>
                  other !== turn &&
                  other.start < turn.end &&
                  other.end > turn.start
              )
          )
          .sort((a, b) => b.end - b.start - (a.end - a.start))[0];
        if (sample) {
          const begin = Math.floor(sample.start * 24_000) * 2;
          const end =
            Math.floor(Math.min(sample.end, sample.start + 8) * 24_000) * 2;
          refs.set(
            id,
            `data:audio/wav;base64,${wav(pcm.subarray(begin, end)).toString("base64")}`
          );
        }
      }
      for (const [i, turn] of turns.entries()) {
        if (!turn.text.trim()) {
          continue;
        }
        const id = turn.speaker ? names.get(turn.speaker)! : null;
        onSegment({
          endMs: Math.round(start / 48 + turn.end * 1000),
          id: `${index}-${i}`,
          receivedAt: Date.now(),
          speakerId: id,
          speakerName: id ? `Speaker ${id.slice(8)}` : "Unknown speaker",
          startMs: Math.round(start / 48 + turn.start * 1000),
          text: turn.text,
        });
      }
    }
    function flush() {
      if (!bytes) {
        return;
      }
      const file = path();
      const index = chunkIndex++;
      const length = bytes;
      const start = offset;
      offset += bytes;
      bytes = 0;
      onProgress?.(Math.ceil(pendingBytes / BYTES_PER_SECOND));
      queue = queue.then(async () => {
        if (failure || closed) {
          return;
        }
        try {
          await transcribe(file, index, start, length);
        } catch (error) {
          fail(error);
        } finally {
          pendingBytes -= length;
          onProgress?.(Math.ceil(pendingBytes / BYTES_PER_SECOND));
          rmSync(file, { force: true });
        }
      });
    }
    return {
      async close() {
        closed = true;
        abort.abort();
        refs.clear();
        // Remove files after the outstanding request settles, including failed queued chunks.
        await queue.catch(() => undefined);
        rmSync(directory, { force: true, recursive: true });
      },
      async finish() {
        if (!finished) {
          finished = true;
          flush();
        }
        await queue;
        if (failure) {
          throw failure;
        }
        combined.throwIfAborted();
      },
      push(audio) {
        if (failure) {
          throw failure;
        }
        combined.throwIfAborted();
        if (finished || closed) {
          throw new Error("Recording has stopped");
        }
        if (audio.length % 2) {
          throw new Error("Invalid PCM frame");
        }
        if (pendingBytes + audio.length > 300 * BYTES_PER_SECOND) {
          throw new Error(
            "Transcription cannot keep up; recording ended early"
          );
        }
        let position = 0;
        while (position < audio.length) {
          const count = Math.min(CHUNK_BYTES - bytes, audio.length - position);
          if (!bytes) {
            writeFileSync(path(), new Uint8Array(), { mode: 0o600 });
          }
          appendFileSync(path(), audio.subarray(position, position + count));
          bytes += count;
          pendingBytes += count;
          position += count;
          if (bytes === CHUNK_BYTES) {
            flush();
          }
        }
      },
    };
  },
};

export const transcriptionProviders: Record<string, TranscriptionProvider> = {
  openai,
};
