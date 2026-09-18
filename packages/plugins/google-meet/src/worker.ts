import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { privateJson, readSettings } from "./actions";
import { type Meeting, MeetingStore } from "./store";
import {
  type TranscriptionSession,
  transcriptionProviders,
} from "./transcription";

export function createStreamMeeting(
  meeting: Meeting,
  store: MeetingStore,
  directory: string,
  signal: AbortSignal
) {
  let transcription: TranscriptionSession | undefined;
  let failure: Error | undefined;
  let queue = Promise.resolve();
  let closing: Promise<void> | undefined;
  const abort = new AbortController();
  const combined = AbortSignal.any([signal, abort.signal]);
  const started = (async () => {
    const config = readSettings(directory);
    transcription = await transcriptionProviders[config.provider]!.connect({
      ...config,
      onError: (error) => {
        failure = error;
        abort.abort();
      },
      onSegment: (segment) => store.addSegment(meeting.id, segment),
      signal: combined,
    });
    store.update(meeting.id, "transcribing");
  })().catch((error) => {
    failure =
      error instanceof Error ? error : new Error("Meeting capture failed");
    throw failure;
  });

  return {
    close(requestedStop = false) {
      closing ??= (async () => {
        await queue.catch((error) => {
          failure ??=
            error instanceof Error
              ? error
              : new Error("Meeting capture failed");
        });
        await started.catch(() => undefined);
        if (transcription) {
          try {
            await transcription.finish();
          } catch (error) {
            failure ??=
              error instanceof Error
                ? error
                : new Error("Final transcript incomplete");
          }
          transcription.close();
        }
        abort.abort();
        store.update(
          meeting.id,
          failure || signal.aborted ? "failed" : "finished",
          failure?.message ??
            (requestedStop ? null : "Capture ended; partial transcript saved")
        );
      })();
      return closing;
    },
    push(frame: Uint8Array) {
      if (frame.byteLength > 48_000) {
        throw new Error("Audio frame is too large");
      }
      queue = queue.then(async () => {
        await started;
        if (!combined.aborted) {
          transcription?.push(frame);
        }
      });
      return queue;
    },
    ready: started,
  };
}

export function captureSession(directory: string) {
  try {
    return JSON.parse(
      readFileSync(join(directory, "capture.json"), "utf8")
    ) as {
      expiresAt: number;
      meetingId: string;
      token: string;
    };
  } catch {}
}

async function runWorker(directory: string, dataDir: string, orgId: string) {
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const store = new MeetingStore(dataDir, orgId);
  store.recover();
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  let consumedToken: string | undefined;
  const captureHost = process.env.NAKAMA_MEET_CAPTURE_HOST ?? "127.0.0.1";
  const capture = Bun.serve<{
    meetingId: string;
    stream?: ReturnType<typeof createStreamMeeting>;
  }>({
    async fetch(request, server) {
      const url = new URL(request.url);
      if (request.method !== "GET" || url.pathname !== "/capture") {
        return new Response(null, { status: 404 });
      }
      const meetingId = url.searchParams.get("meetingId");
      const supplied = url.searchParams.get("token");
      const session = captureSession(dataDir);
      const meeting = meetingId ? store.get(meetingId) : undefined;
      if (
        !(meeting && session) ||
        session.meetingId !== meeting.id ||
        session.token !== supplied ||
        session.token === consumedToken ||
        session.expiresAt < Date.now() ||
        !["queued", "joining", "transcribing"].includes(meeting.state)
      ) {
        return new Response(null, { status: 401 });
      }
      if (server.upgrade(request, { data: { meetingId: meeting.id } })) {
        consumedToken = session.token;
        rmSync(join(dataDir, "capture.json"), { force: true });
        return;
      }
      return new Response(null, { status: 426 });
    },
    hostname: captureHost,
    port: Number(process.env.NAKAMA_MEET_CAPTURE_PORT ?? 0),
    websocket: {
      close(ws) {
        void ws.data.stream?.close(false);
      },
      message(ws, message) {
        if (typeof message === "string") {
          try {
            const event = JSON.parse(message) as { type?: string };
            if (event.type === "stop") {
              void ws.data.stream?.close(true);
              ws.close();
            }
          } catch {
            ws.close(1003, "Invalid message");
          }
          return;
        }
        void ws.data.stream
          ?.push(
            new Uint8Array(
              message instanceof ArrayBuffer ? message : message.buffer
            )
          )
          .catch(() => ws.close(1011, "Audio stream failed"));
      },
      open(ws) {
        const meeting = store.get(ws.data.meetingId);
        if (!meeting) {
          ws.close(1008, "Meeting not found");
          return;
        }
        const stream = createStreamMeeting(
          meeting,
          store,
          dataDir,
          abort.signal
        );
        ws.data.stream = stream;
        void stream.ready
          .then(() => ws.send(JSON.stringify({ type: "ready" })))
          .catch(() => ws.close(1011, "Transcription unavailable"));
      },
    },
  });
  const status = () =>
    privateJson(join(directory, "status.json"), {
      captureUrl:
        process.env.NAKAMA_MEET_CAPTURE_ORIGIN ??
        `ws://${captureHost}:${capture.port}/capture`,
      state: abort.signal.aborted ? "stopped" : "ready",
      updatedAt: Date.now(),
    });
  status();
  const heartbeat = setInterval(status, 3000);
  try {
    while (!abort.signal.aborted) {
      await Bun.sleep(500);
    }
  } finally {
    clearInterval(heartbeat);
    capture.stop(true);
    rmSync(join(directory, "status.json"), { force: true });
    store.close();
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

if (import.meta.main) {
  const directory = process.env.NAKAMA_WORKER_DATA_DIR;
  const dataDir = process.env.NAKAMA_PLUGIN_DATA_DIR;
  const orgId = process.env.NAKAMA_ORG_ID;
  if (!(directory && dataDir && orgId)) {
    throw new Error("Start this worker through Nakama");
  }
  await runWorker(directory, dataDir, orgId);
}
