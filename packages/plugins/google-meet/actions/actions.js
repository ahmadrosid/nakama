// @bun
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

// src/actions.ts
function privateJson(path, data) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  writeFileSync2(temporary, JSON.stringify(data), { mode: 384 });
  renameSync2(temporary, path);
}
function readSettings(directory) {
  return transcriptionConfig(JSON.parse(readFileSync(join2(directory, "settings.json"), "utf8")));
}
async function connectionCommand(directory, action) {
  const endpoint = JSON.parse(readFileSync(join2(directory, "workers", "meet", "control.json"), "utf8"));
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) {
    throw new Error("Invalid worker endpoint");
  }
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/${action}`, {
    headers: { Authorization: `Bearer ${endpoint.token}` },
    method: "POST",
    signal: AbortSignal.timeout(5000)
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error ?? "Google connection request failed");
  }
  return result;
}
async function run(input, context) {
  if (context.actor.role === "viewer") {
    throw new Error("Member access required");
  }
  const store = new MeetingStore(context.dataDir, context.orgId);
  const canAccess = (meeting) => (context.actor.role === "admin" || meeting.actorId === context.actor.id) && (!context.profileId || meeting.profileId === context.profileId);
  try {
    const action = context.actionKey ?? "";
    const settingsPath = join2(context.dataDir, "settings.json");
    if (["connect", "connection", "finish-login", "disconnect"].includes(action)) {
      if (context.actor.role !== "admin") {
        throw new Error("Admin access required");
      }
      return connectionCommand(context.dataDir, action);
    }
    if (action === "configure") {
      if (context.actor.role !== "admin") {
        throw new Error("Admin access required");
      }
      const previous = existsSync2(settingsPath) ? readSettings(context.dataDir) : {};
      const config = transcriptionConfig({
        ...previous,
        ...input,
        apiKey: input.apiKey || previous.apiKey
      });
      privateJson(settingsPath, config);
      return { configured: true };
    }
    let worker = {
      state: "stopped"
    };
    try {
      worker = JSON.parse(readFileSync(join2(context.dataDir, "workers", "meet", "status.json"), "utf8"));
    } catch {}
    if (!worker.updatedAt || Date.now() - worker.updatedAt > 15000) {
      worker = { state: "stopped" };
    }
    if (action === "meetings") {
      return {
        authenticated: worker.authenticated === true,
        canConfigure: context.actor.role === "admin",
        configured: existsSync2(settingsPath),
        meetings: store.list(context.actor.role === "admin" ? null : context.actor.id, context.profileId ?? null),
        worker
      };
    }
    if (action === "join") {
      if (worker.state !== "ready") {
        throw new Error(worker.message ?? "Start the Google Meet worker in Workers first");
      }
      readSettings(context.dataDir);
      if (!worker.authenticated || worker.loginBusy) {
        throw new Error("Configure Google login before joining a meeting");
      }
      return store.create(String(input.url ?? "").trim(), context.actor.id, context.profileId, Number(input.durationMinutes ?? 120));
    }
    const meeting = store.get(String(input.meetingId ?? ""));
    if (!(meeting && canAccess(meeting))) {
      throw new Error("Meeting not found");
    }
    if (action === "status") {
      return { meeting, worker };
    }
    if (action === "leave") {
      store.stop(meeting.id);
      return { ...meeting, stopRequested: 1 };
    }
    if (action === "transcript") {
      const after = Number(input.after ?? 0);
      if (!Number.isSafeInteger(after) || after < 0) {
        throw new Error("Invalid transcript cursor");
      }
      const segments = store.transcript(meeting.id, after);
      return {
        meeting,
        nextCursor: segments.at(-1)?.sequence ?? after,
        segments
      };
    }
    throw new Error("Unknown meeting action");
  } finally {
    store.close();
  }
}
export {
  privateJson,
  readSettings,
  run
};
