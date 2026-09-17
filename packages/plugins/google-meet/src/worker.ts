import { mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { privateJson, readSettings } from "./actions";
import { authenticate, captureMeeting } from "./browser";
import { type Meeting, MeetingStore } from "./store";
import {
  type TranscriptionSession,
  transcriptionProviders,
} from "./transcription";

export async function runMeeting(
  meeting: Meeting,
  store: MeetingStore,
  directory: string,
  signal: AbortSignal,
  capture = captureMeeting
) {
  const abort = new AbortController();
  const combined = AbortSignal.any([signal, abort.signal]);
  let audio: Awaited<ReturnType<typeof capture>> | undefined;
  let session: TranscriptionSession | undefined;
  let failure: Error | undefined;
  let ended = false;
  let checking = false;
  const deadline = Date.now() + meeting.durationMinutes * 60_000;
  const timer = setInterval(async () => {
    if (checking || combined.aborted) {
      return;
    }
    checking = true;
    try {
      if (
        store.get(meeting.id)?.stopRequested ||
        Date.now() >= deadline ||
        (audio && !(await audio.inCall()))
      ) {
        ended = true;
        abort.abort();
      }
    } catch {
      if (!combined.aborted) {
        failure = new Error("Lost the Google Meet connection");
        abort.abort();
      }
    } finally {
      checking = false;
    }
  }, 500);
  store.update(meeting.id, "joining");
  try {
    if (meeting.stopRequested) {
      ended = true;
      return;
    }
    const config = readSettings(directory);
    audio = await capture({
      directory,
      id: meeting.id,
      signal: combined,
      url: meeting.url,
    });
    combined.throwIfAborted();
    session = await transcriptionProviders[config.provider]!.connect({
      ...config,
      onError: (error) => {
        failure = error;
        abort.abort();
      },
      onSegment: (segment) => store.addSegment(meeting.id, segment),
      signal: combined,
    });
    combined.throwIfAborted();
    store.update(meeting.id, "transcribing");
    // FFmpeg pipe reads need not align to PCM samples. Send 100ms audio frames.
    let pending = Buffer.alloc(0);
    for await (const chunk of audio.audio) {
      if (combined.aborted) {
        break;
      }
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4800) {
        session.push(pending.subarray(0, 4800));
        pending = pending.subarray(4800);
      }
    }
    if (!combined.aborted) {
      throw new Error("Meeting audio capture stopped unexpectedly");
    }
    if (pending.length >= 2) {
      session.push(pending.subarray(0, pending.length - (pending.length % 2)));
    }
  } catch (error) {
    if (!(ended || signal.aborted)) {
      failure ??=
        error instanceof Error
          ? error
          : new Error("Meeting transcription failed");
    }
  } finally {
    clearInterval(timer);
    await audio?.close();
    if (session) {
      try {
        await session.finish();
      } catch (error) {
        failure ??=
          error instanceof Error
            ? error
            : new Error("Final transcript incomplete");
      }
      session.close();
    }
    store.update(
      meeting.id,
      failure || signal.aborted ? "failed" : "finished",
      failure?.message ??
        (signal.aborted ? "Worker stopped; partial transcript saved" : null)
    );
  }
}

async function runWorker(directory: string, dataDir: string, orgId: string) {
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const store = new MeetingStore(dataDir, orgId);
  store.recover();
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const status = () =>
    privateJson(join(directory, "status.json"), {
      state: abort.signal.aborted ? "stopped" : "ready",
      updatedAt: Date.now(),
    });
  status();
  const heartbeat = setInterval(status, 3000);
  try {
    while (!abort.signal.aborted) {
      const next = store.next();
      if (next) {
        await runMeeting(next, store, dataDir, abort.signal);
      } else {
        await Bun.sleep(500);
      }
    }
  } finally {
    clearInterval(heartbeat);
    status();
    store.close();
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

if (import.meta.main) {
  if (process.argv[2] === "auth") {
    const output = process.argv[3];
    if (!(output && isAbsolute(output))) {
      throw new Error(
        "Usage: bun workers/meet.js auth /absolute/path/google-login.json"
      );
    }
    await authenticate(output);
  } else {
    const directory = process.env.NAKAMA_WORKER_DATA_DIR;
    const dataDir = process.env.NAKAMA_PLUGIN_DATA_DIR;
    const orgId = process.env.NAKAMA_ORG_ID;
    if (!(directory && dataDir && orgId)) {
      throw new Error("Start this worker through Nakama");
    }
    await runWorker(directory, dataDir, orgId);
  }
}
