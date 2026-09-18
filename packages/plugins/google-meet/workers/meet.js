// @bun
// src/worker.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync2, rmSync as rmSync2 } from "fs";
import { join as join3 } from "path";

// src/actions.ts
import { existsSync as existsSync2, readFileSync, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "fs";
import { join as join2 } from "path";

// src/store.ts
import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "fs";
import { join } from "path";

class MeetingStore {
  directory;
  db;
  constructor(directory, orgId) {
    this.directory = directory;
    mkdirSync(directory, { mode: 448, recursive: true });
    const path = join(directory, "meetings.sqlite");
    this.db = new Database(path);
    chmodSync(path, 384);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tenant (id INTEGER PRIMARY KEY CHECK(id=1), orgId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY, actorId TEXT NOT NULL, profileId TEXT, url TEXT NOT NULL,
        state TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
        durationMinutes INTEGER NOT NULL, stopRequested INTEGER NOT NULL DEFAULT 0, error TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_meeting ON meetings ((1))
        WHERE state IN ('queued','joining','transcribing');
      CREATE TABLE IF NOT EXISTS segments (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, meetingId TEXT NOT NULL,
        id TEXT NOT NULL, text TEXT NOT NULL, receivedAt INTEGER NOT NULL,
        UNIQUE(meetingId,id));`);
    this.db.query("INSERT OR IGNORE INTO tenant VALUES (1, ?)").run(orgId);
    if (this.db.query("SELECT orgId FROM tenant WHERE id=1").get()?.orgId !== orgId) {
      this.db.close();
      throw new Error("Meeting data belongs to another organization");
    }
    try {
      this.restoreTranscripts(false);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  create(url, actorId, profileId, durationMinutes) {
    if (!/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(url)) {
      throw new Error("Use a Google Meet link such as https://meet.google.com/abc-defg-hij");
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 120) {
      throw new Error("Meeting duration must be between 1 and 120 minutes");
    }
    const id = randomUUID();
    try {
      this.db.query("INSERT INTO meetings (id,actorId,profileId,url,state,createdAt,updatedAt,durationMinutes) VALUES (?,?,?,?,'queued',?,?,?)").run(id, actorId, profileId ?? null, url, Date.now(), Date.now(), durationMinutes);
    } catch {
      throw new Error("An active meeting already exists in this organization");
    }
    return this.get(id);
  }
  get(id) {
    return this.db.query("SELECT * FROM meetings WHERE id=?").get(id);
  }
  list(actorId = null, profileId = null) {
    return this.db.query("SELECT * FROM meetings WHERE (? IS NULL OR actorId=?) AND (? IS NULL OR profileId=?) ORDER BY createdAt DESC LIMIT 100").all(actorId, actorId, profileId, profileId).map((meeting) => ({
      ...meeting,
      transcriptFile: existsSync(this.transcriptPath(meeting.id)) ? `meeting-${meeting.id}.txt` : undefined
    }));
  }
  next() {
    return this.db.query("SELECT * FROM meetings WHERE state='queued' LIMIT 1").get();
  }
  recover() {
    this.db.query("UPDATE meetings SET state='failed', error='Meeting worker restarted; partial transcript saved',updatedAt=? WHERE state IN ('joining','transcribing')").run(Date.now());
    this.restoreTranscripts(true);
  }
  update(id, state, error = null) {
    this.db.query("UPDATE meetings SET state=?,error=?,updatedAt=? WHERE id=?").run(state, error, Date.now(), id);
  }
  stop(id) {
    this.db.query("UPDATE meetings SET stopRequested=1 WHERE id=?").run(id);
  }
  addSegment(meetingId, segment) {
    if (!this.get(meetingId)) {
      throw new Error("Meeting not found");
    }
    this.db.query("INSERT OR IGNORE INTO segments (meetingId,id,text,receivedAt) VALUES (?,?,?,?)").run(meetingId, segment.id, segment.text, segment.receivedAt);
    this.saveTranscript(meetingId);
  }
  transcriptPath(id) {
    return join(this.directory, "transcripts", `meeting-${id}.txt`);
  }
  restoreTranscripts(overwrite) {
    const meetings = this.db.query("SELECT id FROM meetings WHERE EXISTS (SELECT 1 FROM segments WHERE meetingId=meetings.id)").all();
    for (const meeting of meetings) {
      if (overwrite || !existsSync(this.transcriptPath(meeting.id))) {
        this.saveTranscript(meeting.id);
      }
    }
  }
  saveTranscript(id) {
    this.db.transaction(() => {
      const rows = this.db.query("SELECT text FROM segments WHERE meetingId=? ORDER BY sequence").all(id);
      mkdirSync(join(this.directory, "transcripts"), {
        mode: 448,
        recursive: true
      });
      const path = this.transcriptPath(id);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, rows.map((row) => `${row.text}
`).join(""), { mode: 384 });
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
    }).immediate();
  }
  transcript(id, after = 0) {
    return this.db.query("SELECT sequence,id,text,receivedAt FROM segments WHERE meetingId=? AND sequence>? ORDER BY sequence LIMIT 2000").all(id, after);
  }
  close() {
    this.db.close();
  }
}

// src/transcription.ts
function transcriptionConfig(value) {
  const provider = value.provider ?? "openai";
  const model = value.model ?? "gpt-transcribe";
  if (provider !== "openai" || model !== "gpt-transcribe") {
    throw new Error("Unsupported transcription provider or model");
  }
  if (typeof value.apiKey !== "string" || !value.apiKey.trim() || value.apiKey.length > 4096) {
    throw new Error("An OpenAI API key is required for transcription");
  }
  return { apiKey: value.apiKey.trim(), model, provider };
}

class OpenAITranscript {
  order = [];
  completed = new Map;
  seen = new Set;
  accept(event) {
    if (event.type === "conversation.item.input_audio_transcription.failed" || event.type === "error") {
      throw new Error("Transcription failed; check the API key, model access, and API balance");
    }
    const id = typeof event.item_id === "string" ? event.item_id : undefined;
    if (!id) {
      return;
    }
    if (event.type === "input_audio_buffer.committed" && !this.seen.has(id)) {
      this.seen.add(id);
      this.order.push(id);
    }
    if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string" && this.order.includes(id)) {
      this.completed.set(id, {
        id,
        receivedAt: Date.now(),
        text: event.transcript.trim()
      });
    }
  }
  drain() {
    const result = [];
    while (this.order[0] && this.completed.has(this.order[0])) {
      const id = this.order.shift();
      const segment = this.completed.get(id);
      this.completed.delete(id);
      if (segment.text) {
        result.push(segment);
      }
    }
    return result;
  }
  get pending() {
    return this.order.length;
  }
}
var openai = {
  async connect({ apiKey, model, signal, onSegment, onError }) {
    signal.throwIfAborted();
    const Socket = WebSocket;
    const socket = new Socket("wss://api.openai.com/v1/realtime?intent=transcription", {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const transcript = new OpenAITranscript;
    let closing = false;
    let ready = false;
    let failure;
    let sentAudio = false;
    let finalCommit = false;
    let finishing = false;
    let lastEvent = Date.now();
    let resolveReady;
    let rejectReady;
    const connected = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const fail = (error) => {
      if (failure || closing) {
        return;
      }
      failure = error;
      rejectReady(error);
      if (ready) {
        onError(error);
      }
    };
    const timeout = setTimeout(() => fail(new Error("Transcription connection timed out")), 15000);
    const abort = () => fail(new Error("Transcription connection cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    socket.addEventListener("open", () => socket.send(JSON.stringify({
      session: {
        audio: {
          input: {
            format: { rate: 24000, type: "audio/pcm" },
            transcription: { model },
            turn_detection: {
              prefix_padding_ms: 300,
              silence_duration_ms: 700,
              threshold: 0.5,
              type: "server_vad"
            }
          }
        },
        type: "transcription"
      },
      type: "session.update"
    })));
    socket.addEventListener("message", (message) => {
      try {
        const event = JSON.parse(String(message.data));
        lastEvent = Date.now();
        if (event.type === "session.updated") {
          ready = true;
          resolveReady();
        }
        if (event.type === "input_audio_buffer.committed") {
          finalCommit = false;
        }
        if (event.type === "error" && finishing && event.error?.code === "input_audio_buffer_commit_empty") {
          finalCommit = false;
          return;
        }
        transcript.accept(event);
        for (const segment of transcript.drain()) {
          onSegment(segment);
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Invalid transcription response"));
      }
    });
    socket.addEventListener("error", () => fail(new Error("Transcription connection failed")));
    socket.addEventListener("close", () => fail(new Error("Transcription connection closed unexpectedly")));
    try {
      await connected;
    } catch (error) {
      closing = true;
      socket.close();
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
    return {
      close() {
        closing = true;
        socket.close();
      },
      async finish() {
        if (failure) {
          throw failure;
        }
        if (!sentAudio) {
          return;
        }
        finishing = true;
        finalCommit = true;
        lastEvent = Date.now();
        socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (failure) {
            throw failure;
          }
          if (!finalCommit && transcript.pending === 0 && Date.now() - lastEvent > 250) {
            return;
          }
          await Bun.sleep(50);
        }
        throw new Error("Timed out waiting for the final transcript; partial transcript was saved");
      },
      push(audio) {
        if (failure) {
          throw failure;
        }
        if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 2400000) {
          throw new Error("Transcription connection cannot keep up with meeting audio");
        }
        sentAudio = true;
        socket.send(JSON.stringify({
          audio: Buffer.from(audio).toString("base64"),
          type: "input_audio_buffer.append"
        }));
      }
    };
  }
};
var transcriptionProviders = {
  openai
};

// src/actions.ts
function privateJson(path, data) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  writeFileSync2(temporary, JSON.stringify(data), { mode: 384 });
  renameSync2(temporary, path);
}
function readSettings(directory) {
  return transcriptionConfig(JSON.parse(readFileSync(join2(directory, "settings.json"), "utf8")));
}

// src/worker.ts
function createStreamMeeting(meeting, store, directory, signal) {
  let transcription;
  let failure;
  let queue = Promise.resolve();
  let closing;
  const abort = new AbortController;
  const combined = AbortSignal.any([signal, abort.signal]);
  const started = (async () => {
    const config = readSettings(directory);
    transcription = await transcriptionProviders[config.provider].connect({
      ...config,
      onError: (error) => {
        failure = error;
        abort.abort();
      },
      onSegment: (segment) => store.addSegment(meeting.id, segment),
      signal: combined
    });
    store.update(meeting.id, "transcribing");
  })().catch((error) => {
    failure = error instanceof Error ? error : new Error("Meeting capture failed");
    throw failure;
  });
  return {
    close(requestedStop = false) {
      closing ??= (async () => {
        await queue.catch((error) => {
          failure ??= error instanceof Error ? error : new Error("Meeting capture failed");
        });
        await started.catch(() => {
          return;
        });
        if (transcription) {
          try {
            await transcription.finish();
          } catch (error) {
            failure ??= error instanceof Error ? error : new Error("Final transcript incomplete");
          }
          transcription.close();
        }
        abort.abort();
        store.update(meeting.id, failure || signal.aborted ? "failed" : "finished", failure?.message ?? (requestedStop ? null : "Capture ended; partial transcript saved"));
      })();
      return closing;
    },
    push(frame) {
      if (frame.byteLength > 48000) {
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
    ready: started
  };
}
function captureSession(directory) {
  try {
    return JSON.parse(readFileSync2(join3(directory, "capture.json"), "utf8"));
  } catch {}
}
async function runWorker(directory, dataDir, orgId) {
  mkdirSync2(directory, { mode: 448, recursive: true });
  const store = new MeetingStore(dataDir, orgId);
  store.recover();
  const abort = new AbortController;
  const stop = () => abort.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  let consumedToken;
  const captureHost = process.env.NAKAMA_MEET_CAPTURE_HOST ?? "127.0.0.1";
  const capture = Bun.serve({
    async fetch(request, server) {
      const url = new URL(request.url);
      if (request.method !== "GET" || url.pathname !== "/capture") {
        return new Response(null, { status: 404 });
      }
      const meetingId = url.searchParams.get("meetingId");
      const supplied = url.searchParams.get("token");
      const session = captureSession(dataDir);
      const meeting = meetingId ? store.get(meetingId) : undefined;
      if (!(meeting && session) || session.meetingId !== meeting.id || session.token !== supplied || session.token === consumedToken || session.expiresAt < Date.now() || !["queued", "joining", "transcribing"].includes(meeting.state)) {
        return new Response(null, { status: 401 });
      }
      if (server.upgrade(request, { data: { meetingId: meeting.id } })) {
        consumedToken = session.token;
        rmSync2(join3(dataDir, "capture.json"), { force: true });
        return;
      }
      return new Response(null, { status: 426 });
    },
    hostname: captureHost,
    port: Number(process.env.NAKAMA_MEET_CAPTURE_PORT ?? 0),
    websocket: {
      close(ws) {
        ws.data.stream?.close(false);
      },
      message(ws, message) {
        if (typeof message === "string") {
          try {
            const event = JSON.parse(message);
            if (event.type === "stop") {
              ws.data.stream?.close(true);
              ws.close();
            }
          } catch {
            ws.close(1003, "Invalid message");
          }
          return;
        }
        ws.data.stream?.push(new Uint8Array(message instanceof ArrayBuffer ? message : message.buffer)).catch(() => ws.close(1011, "Audio stream failed"));
      },
      open(ws) {
        const meeting = store.get(ws.data.meetingId);
        if (!meeting) {
          ws.close(1008, "Meeting not found");
          return;
        }
        const stream = createStreamMeeting(meeting, store, dataDir, abort.signal);
        ws.data.stream = stream;
        stream.ready.then(() => ws.send(JSON.stringify({ type: "ready" }))).catch(() => ws.close(1011, "Transcription unavailable"));
      }
    }
  });
  const status = () => privateJson(join3(directory, "status.json"), {
    captureUrl: process.env.NAKAMA_MEET_CAPTURE_ORIGIN ?? `ws://${captureHost}:${capture.port}/capture`,
    state: abort.signal.aborted ? "stopped" : "ready",
    updatedAt: Date.now()
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
    rmSync2(join3(directory, "status.json"), { force: true });
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
export {
  captureSession,
  createStreamMeeting
};
