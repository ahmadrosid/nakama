import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { formatTranscript, type TranscriptSegment } from "./transcript-format";

export type MeetingState =
  | "queued"
  | "joining"
  | "recording"
  | "transcribing"
  | "finished"
  | "failed";
export interface Meeting {
  actorId: string;
  createdAt: number;
  durationMinutes: number;
  error: string | null;
  id: string;
  pendingSeconds?: number;
  preview?: string | null;
  profileId: string | null;
  sourceName?: string | null;
  state: MeetingState;
  stopRequested: number;
  title?: string | null;
  transcriptFile?: string;
  updatedAt: number;
  url: string;
}

export class MeetingStore {
  private readonly db: Database;
  constructor(
    private readonly directory: string,
    orgId: string
  ) {
    mkdirSync(directory, { mode: 0o700, recursive: true });
    const path = join(directory, "meetings.sqlite");
    this.db = new Database(path);
    chmodSync(path, 0o600);
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
    if (
      this.db
        .query<{ orgId: string }, []>("SELECT orgId FROM tenant WHERE id=1")
        .get()?.orgId !== orgId
    ) {
      this.db.close();
      throw new Error("Meeting data belongs to another organization");
    }
    try {
      this.db
        .transaction(() => {
          const segmentColumns = this.db
            .query<{ name: string }, []>("PRAGMA table_info(segments)")
            .all();
          for (const [name, type] of [
            ["speakerId", "TEXT"],
            ["speakerName", "TEXT"],
            ["startMs", "INTEGER"],
            ["endMs", "INTEGER"],
          ]) {
            if (!segmentColumns.some((column) => column.name === name)) {
              this.db.exec(`ALTER TABLE segments ADD COLUMN ${name} ${type}`);
            }
          }
          const activeIndex = this.db
            .query<{ sql: string }, []>(
              "SELECT sql FROM sqlite_master WHERE name='one_active_meeting'"
            )
            .get();
          if (!activeIndex?.sql.includes("'recording'")) {
            this.db.exec(
              "DROP INDEX IF EXISTS one_active_meeting; CREATE UNIQUE INDEX one_active_meeting ON meetings ((1)) WHERE state IN ('queued','joining','recording','transcribing')"
            );
          }
          const columns = this.db
            .query<{ name: string }, []>("PRAGMA table_info(meetings)")
            .all();
          if (!columns.some((column) => column.name === "pendingSeconds")) {
            this.db.exec(
              "ALTER TABLE meetings ADD COLUMN pendingSeconds INTEGER NOT NULL DEFAULT 0"
            );
          }
          if (!columns.some((column) => column.name === "title")) {
            this.db.exec("ALTER TABLE meetings ADD COLUMN title TEXT");
          }
          if (!columns.some((column) => column.name === "sourceName")) {
            this.db.exec("ALTER TABLE meetings ADD COLUMN sourceName TEXT");
          }
        })
        .immediate();
      this.restoreTranscripts(false);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  create(
    url: string,
    actorId: string,
    profileId: string | undefined,
    durationMinutes: number
  ): Meeting {
    if (
      !/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(url)
    ) {
      throw new Error(
        "Use a Google Meet link such as https://meet.google.com/abc-defg-hij"
      );
    }
    if (
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > 120
    ) {
      throw new Error("Meeting duration must be between 1 and 120 minutes");
    }
    const id = randomUUID();
    try {
      this.db
        .query(
          "INSERT INTO meetings (id,actorId,profileId,url,state,createdAt,updatedAt,durationMinutes) VALUES (?,?,?,?,'queued',?,?,?)"
        )
        .run(
          id,
          actorId,
          profileId ?? null,
          url,
          Date.now(),
          Date.now(),
          durationMinutes
        );
    } catch {
      throw new Error("An active meeting already exists in this organization");
    }
    return this.get(id)!;
  }

  get(id: string) {
    return this.db
      .query<Meeting, [string]>("SELECT * FROM meetings WHERE id=?")
      .get(id);
  }
  importFile(
    filename: string,
    content: string,
    actorId: string,
    profileId?: string
  ) {
    const id = randomUUID();
    try {
      this.db
        .transaction(() => {
          this.db
            .query(
              "INSERT INTO meetings (id,actorId,profileId,url,state,createdAt,updatedAt,durationMinutes,sourceName) VALUES (?,?,?,'',?,?,?,0,?)"
            )
            .run(
              id,
              actorId,
              profileId ?? null,
              "finished",
              Date.now(),
              Date.now(),
              filename
            );
          const insert = this.db.query(
            "INSERT INTO segments (meetingId,id,text,receivedAt) VALUES (?,?,?,?)"
          );
          for (let offset = 0; offset < content.length; ) {
            let end = Math.min(offset + 32_000, content.length);
            if (
              end < content.length &&
              /[\uD800-\uDBFF]/.test(content[end - 1]!)
            ) {
              end--;
            }
            insert.run(
              id,
              `upload-${offset}`,
              content.slice(offset, end),
              Date.now()
            );
            offset = end;
          }
          this.saveTranscript(id);
        })
        .immediate();
    } catch (error) {
      rmSync(this.transcriptPath(id), { force: true });
      throw error;
    }
    return this.get(id)!;
  }
  list(actorId: string | null = null, profileId: string | null = null) {
    return this.db
      .query<
        Meeting,
        [string | null, string | null, string | null, string | null]
      >(
        "SELECT meetings.*, (SELECT substr(text, 1, 180) FROM segments WHERE meetingId=meetings.id AND trim(text) != '' ORDER BY sequence LIMIT 1) AS preview FROM meetings WHERE (? IS NULL OR actorId=?) AND (? IS NULL OR profileId=?) ORDER BY createdAt DESC LIMIT 100"
      )
      .all(actorId, actorId, profileId, profileId)
      .map((meeting) => ({
        ...meeting,
        transcriptFile: existsSync(this.transcriptPath(meeting.id))
          ? `meeting-${meeting.id}.txt`
          : undefined,
      }));
  }
  next() {
    return this.db
      .query<Meeting, []>("SELECT * FROM meetings WHERE state='queued' LIMIT 1")
      .get();
  }
  nextUntitled() {
    return this.db
      .query<{ id: string; text: string }, []>(
        "SELECT id, (SELECT group_concat(text, char(10)) FROM (SELECT text FROM segments WHERE meetingId=meetings.id ORDER BY sequence)) AS text FROM meetings WHERE title IS NULL AND state IN ('finished','failed') AND EXISTS (SELECT 1 FROM segments WHERE meetingId=meetings.id AND trim(text) != '') ORDER BY createdAt DESC LIMIT 1"
      )
      .get();
  }
  setTitle(id: string, title: string) {
    this.db.query("UPDATE meetings SET title=? WHERE id=?").run(title, id);
  }
  recover() {
    this.db
      .query(
        "UPDATE meetings SET state='failed', error='Meeting worker restarted; partial transcript saved',updatedAt=? WHERE state IN ('queued','joining','recording','transcribing')"
      )
      .run(Date.now());
    this.db
      .query(
        "UPDATE meetings SET pendingSeconds=0 WHERE state IN ('finished','failed')"
      )
      .run();
    this.restoreTranscripts(true);
  }
  update(id: string, state: MeetingState, error: string | null = null) {
    this.db
      .query("UPDATE meetings SET state=?,error=?,updatedAt=? WHERE id=?")
      .run(state, error, Date.now(), id);
  }
  setPending(id: string, seconds: number) {
    this.db
      .query("UPDATE meetings SET pendingSeconds=? WHERE id=?")
      .run(seconds, id);
  }
  stop(id: string) {
    this.db.query("UPDATE meetings SET stopRequested=1 WHERE id=?").run(id);
  }
  delete(id: string) {
    this.db
      .transaction(() => {
        const meeting = this.get(id);
        if (!(meeting && ["finished", "failed"].includes(meeting.state))) {
          throw new Error("Stop transcription before deleting this meeting");
        }
        rmSync(this.transcriptPath(id), { force: true });
        this.db.query("DELETE FROM segments WHERE meetingId=?").run(id);
        this.db.query("DELETE FROM meetings WHERE id=?").run(id);
      })
      .immediate();
  }
  addSegment(meetingId: string, segment: TranscriptSegment) {
    if (!this.get(meetingId)) {
      throw new Error("Meeting not found");
    }
    this.db
      .query(
        "INSERT OR IGNORE INTO segments (meetingId,id,text,receivedAt,speakerId,speakerName,startMs,endMs) VALUES (?,?,?,?,?,?,?,?)"
      )
      .run(
        meetingId,
        segment.id,
        segment.text,
        segment.receivedAt,
        segment.speakerId ?? null,
        segment.speakerName ?? null,
        segment.startMs ?? null,
        segment.endMs ?? null
      );
    this.saveTranscript(meetingId);
  }
  private transcriptPath(id: string) {
    return join(this.directory, "transcripts", `meeting-${id}.txt`);
  }
  private restoreTranscripts(overwrite: boolean) {
    const meetings = this.db
      .query<{ id: string }, []>(
        "SELECT id FROM meetings WHERE EXISTS (SELECT 1 FROM segments WHERE meetingId=meetings.id)"
      )
      .all();
    for (const meeting of meetings) {
      if (overwrite || !existsSync(this.transcriptPath(meeting.id))) {
        this.saveTranscript(meeting.id);
      }
    }
  }
  private saveTranscript(id: string) {
    // Serialize exports with segment writes so a concurrent reader cannot
    // replace a newer file with an older database snapshot.
    this.db
      .transaction(() => {
        const rows = this.db
          .query<TranscriptSegment, [string]>(
            "SELECT * FROM segments WHERE meetingId=? ORDER BY sequence"
          )
          .all(id);
        mkdirSync(join(this.directory, "transcripts"), {
          mode: 0o700,
          recursive: true,
        });
        const path = this.transcriptPath(id);
        const imported = Boolean(this.get(id)?.sourceName);
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          writeFileSync(temporary, formatTranscript(rows, imported), {
            mode: 0o600,
          });
          renameSync(temporary, path);
        } finally {
          rmSync(temporary, { force: true });
        }
      })
      .immediate();
  }
  transcript(id: string, after = 0) {
    const rows = this.db
      .query<TranscriptSegment & { sequence: number }, [string, number]>(
        "SELECT sequence,id,text,receivedAt,speakerId,speakerName,startMs,endMs FROM segments WHERE meetingId=? AND sequence>? ORDER BY sequence LIMIT 2000"
      )
      .all(id, after);
    let size = 0;
    // Keep paginated responses below the plugin runner's output limit.
    const end = rows.findIndex((row) => {
      size += JSON.stringify(row).length;
      return size > 500_000;
    });
    return end > 0 ? rows.slice(0, end) : rows;
  }
  close() {
    this.db.close();
  }
}
