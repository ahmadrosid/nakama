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

// src/transcript-format.ts
function formatTranscript(segments, imported = false) {
  return segments.map((segment) => imported ? segment.text : `${segment.speakerName ? `${segment.speakerName}: ` : ""}${segment.text}
`).join("");
}

// src/store.ts
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
      this.db.transaction(() => {
        const segmentColumns = this.db.query("PRAGMA table_info(segments)").all();
        for (const [name, type] of [
          ["speakerId", "TEXT"],
          ["speakerName", "TEXT"],
          ["startMs", "INTEGER"],
          ["endMs", "INTEGER"]
        ]) {
          if (!segmentColumns.some((column) => column.name === name)) {
            this.db.exec(`ALTER TABLE segments ADD COLUMN ${name} ${type}`);
          }
        }
        const activeIndex = this.db.query("SELECT sql FROM sqlite_master WHERE name='one_active_meeting'").get();
        if (!activeIndex?.sql.includes("'recording'")) {
          this.db.exec("DROP INDEX IF EXISTS one_active_meeting; CREATE UNIQUE INDEX one_active_meeting ON meetings ((1)) WHERE state IN ('queued','joining','recording','transcribing')");
        }
        const columns = this.db.query("PRAGMA table_info(meetings)").all();
        if (!columns.some((column) => column.name === "pendingSeconds")) {
          this.db.exec("ALTER TABLE meetings ADD COLUMN pendingSeconds INTEGER NOT NULL DEFAULT 0");
        }
        if (!columns.some((column) => column.name === "title")) {
          this.db.exec("ALTER TABLE meetings ADD COLUMN title TEXT");
        }
        if (!columns.some((column) => column.name === "sourceName")) {
          this.db.exec("ALTER TABLE meetings ADD COLUMN sourceName TEXT");
        }
      }).immediate();
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
  importFile(filename, content, actorId, profileId) {
    const id = randomUUID();
    try {
      this.db.transaction(() => {
        this.db.query("INSERT INTO meetings (id,actorId,profileId,url,state,createdAt,updatedAt,durationMinutes,sourceName) VALUES (?,?,?,'',?,?,?,0,?)").run(id, actorId, profileId ?? null, "finished", Date.now(), Date.now(), filename);
        const insert = this.db.query("INSERT INTO segments (meetingId,id,text,receivedAt) VALUES (?,?,?,?)");
        for (let offset = 0;offset < content.length; ) {
          let end = Math.min(offset + 32000, content.length);
          if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1])) {
            end--;
          }
          insert.run(id, `upload-${offset}`, content.slice(offset, end), Date.now());
          offset = end;
        }
        this.saveTranscript(id);
      }).immediate();
    } catch (error) {
      rmSync(this.transcriptPath(id), { force: true });
      throw error;
    }
    return this.get(id);
  }
  list(actorId = null, profileId = null) {
    return this.db.query("SELECT meetings.*, (SELECT substr(text, 1, 180) FROM segments WHERE meetingId=meetings.id AND trim(text) != '' ORDER BY sequence LIMIT 1) AS preview FROM meetings WHERE (? IS NULL OR actorId=?) AND (? IS NULL OR profileId=?) ORDER BY createdAt DESC LIMIT 100").all(actorId, actorId, profileId, profileId).map((meeting) => ({
      ...meeting,
      transcriptFile: existsSync(this.transcriptPath(meeting.id)) ? `meeting-${meeting.id}.txt` : undefined
    }));
  }
  next() {
    return this.db.query("SELECT * FROM meetings WHERE state='queued' LIMIT 1").get();
  }
  nextUntitled() {
    return this.db.query("SELECT id, (SELECT group_concat(text, char(10)) FROM (SELECT text FROM segments WHERE meetingId=meetings.id ORDER BY sequence)) AS text FROM meetings WHERE title IS NULL AND state IN ('finished','failed') AND EXISTS (SELECT 1 FROM segments WHERE meetingId=meetings.id AND trim(text) != '') ORDER BY createdAt DESC LIMIT 1").get();
  }
  setTitle(id, title) {
    this.db.query("UPDATE meetings SET title=? WHERE id=?").run(title, id);
  }
  recover() {
    this.db.query("UPDATE meetings SET state='failed', error='Meeting worker restarted; partial transcript saved',updatedAt=? WHERE state IN ('queued','joining','recording','transcribing')").run(Date.now());
    this.db.query("UPDATE meetings SET pendingSeconds=0 WHERE state IN ('finished','failed')").run();
    this.restoreTranscripts(true);
  }
  update(id, state, error = null) {
    this.db.query("UPDATE meetings SET state=?,error=?,updatedAt=? WHERE id=?").run(state, error, Date.now(), id);
  }
  setPending(id, seconds) {
    this.db.query("UPDATE meetings SET pendingSeconds=? WHERE id=?").run(seconds, id);
  }
  stop(id) {
    this.db.query("UPDATE meetings SET stopRequested=1 WHERE id=?").run(id);
  }
  delete(id) {
    this.db.transaction(() => {
      const meeting = this.get(id);
      if (!(meeting && ["finished", "failed"].includes(meeting.state))) {
        throw new Error("Stop transcription before deleting this meeting");
      }
      rmSync(this.transcriptPath(id), { force: true });
      this.db.query("DELETE FROM segments WHERE meetingId=?").run(id);
      this.db.query("DELETE FROM meetings WHERE id=?").run(id);
    }).immediate();
  }
  addSegment(meetingId, segment) {
    if (!this.get(meetingId)) {
      throw new Error("Meeting not found");
    }
    this.db.query("INSERT OR IGNORE INTO segments (meetingId,id,text,receivedAt,speakerId,speakerName,startMs,endMs) VALUES (?,?,?,?,?,?,?,?)").run(meetingId, segment.id, segment.text, segment.receivedAt, segment.speakerId ?? null, segment.speakerName ?? null, segment.startMs ?? null, segment.endMs ?? null);
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
      const rows = this.db.query("SELECT * FROM segments WHERE meetingId=? ORDER BY sequence").all(id);
      mkdirSync(join(this.directory, "transcripts"), {
        mode: 448,
        recursive: true
      });
      const path = this.transcriptPath(id);
      const imported = Boolean(this.get(id)?.sourceName);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, formatTranscript(rows, imported), {
          mode: 384
        });
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
    }).immediate();
  }
  transcript(id, after = 0) {
    const rows = this.db.query("SELECT sequence,id,text,receivedAt,speakerId,speakerName,startMs,endMs FROM segments WHERE meetingId=? AND sequence>? ORDER BY sequence LIMIT 2000").all(id, after);
    let size = 0;
    const end = rows.findIndex((row) => {
      size += JSON.stringify(row).length;
      return size > 500000;
    });
    return end > 0 ? rows.slice(0, end) : rows;
  }
  close() {
    this.db.close();
  }
}

// src/transcription.ts
function transcriptionConfig(value) {
  const provider = value.provider ?? "openai";
  if (provider !== "openai" || value.model != null && !["gpt-transcribe", "gpt-4o-transcribe-diarize"].includes(String(value.model))) {
    throw new Error("Unsupported transcription provider or model");
  }
  if (typeof value.apiKey !== "string" || !value.apiKey.trim() || value.apiKey.length > 4096) {
    throw new Error("An OpenAI API key is required for transcription");
  }
  return {
    apiKey: value.apiKey.trim(),
    model: "gpt-4o-transcribe-diarize",
    provider
  };
}
var BYTES_PER_SECOND = 48000;
var CHUNK_BYTES = 15 * BYTES_PER_SECOND;

// src/actions.ts
function privateJson(path, data) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  writeFileSync2(temporary, JSON.stringify(data), { mode: 384 });
  renameSync2(temporary, path);
}
function readSettings(directory) {
  return transcriptionConfig(JSON.parse(readFileSync(join2(directory, "settings.json"), "utf8")));
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
        authenticated: worker.state === "ready",
        canConfigure: context.actor.role === "admin",
        captureProtocol: 2,
        configured: existsSync2(settingsPath),
        meetings: store.list(context.actor.role === "admin" ? null : context.actor.id, context.profileId ?? null),
        worker
      };
    }
    if (action === "start-capture") {
      if (worker.state !== "ready") {
        throw new Error(worker.message ?? "Start the Google Meet worker in Workers first");
      }
      readSettings(context.dataDir);
      const meeting2 = store.create(String(input.url ?? "").trim(), context.actor.id, context.profileId, Number(input.durationMinutes ?? 120));
      const token = crypto.randomUUID();
      privateJson(join2(context.dataDir, "capture.json"), {
        actorId: meeting2.actorId,
        expiresAt: Date.now() + meeting2.durationMinutes * 60000,
        meetingId: meeting2.id,
        profileId: meeting2.profileId,
        token
      });
      return {
        ...meeting2,
        capture: worker.captureUrl ? {
          token,
          url: `${worker.captureUrl}?meetingId=${meeting2.id}&token=${token}`
        } : undefined
      };
    }
    if (action === "upload") {
      const filename = input.filename;
      const encoded = input.content;
      if (typeof filename !== "string" || filename.length > 255 || /[\\/\x00-\x1f]/.test(filename)) {
        throw new Error("Invalid filename");
      }
      const markdown = /\.(md|markdown)$/i.test(filename);
      if (!(markdown || /\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)$/i.test(filename))) {
        throw new Error("Choose a Markdown or supported audio file");
      }
      const limit = (markdown ? 1 : 7) * 1024 * 1024;
      if (typeof encoded !== "string" || !encoded.length || encoded.length > Math.ceil(limit / 3) * 4) {
        throw new Error(`File must be under ${markdown ? 1 : 7} MB`);
      }
      const bytes = Buffer.from(encoded, "base64");
      if (!bytes.length || bytes.length > limit || bytes.toString("base64") !== encoded) {
        throw new Error("Invalid file content or size");
      }
      if (markdown) {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (!text.trim() || text.includes("\x00")) {
          throw new Error("Markdown file must contain text");
        }
        return store.importFile(filename, text, context.actor.id, context.profileId);
      }
      if (!context.host) {
        throw new Error("Nakama transcription is unavailable; update the server");
      }
      const result = await context.host({
        data: encoded,
        filename,
        op: "transcribe_audio"
      });
      if (typeof result.text !== "string" || !result.text.trim()) {
        throw new Error("No speech found in the audio file");
      }
      return store.importFile(filename, result.text, context.actor.id, context.profileId);
    }
    const meeting = store.get(String(input.meetingId ?? ""));
    if (!(meeting && canAccess(meeting))) {
      throw new Error("Meeting not found");
    }
    if (action === "status") {
      return { meeting, worker };
    }
    if (action === "delete") {
      store.delete(meeting.id);
      return { deleted: true };
    }
    if (action === "leave") {
      store.stop(meeting.id);
      if (meeting.state === "queued") {
        store.update(meeting.id, "failed", "Capture cancelled before recording started");
      }
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
