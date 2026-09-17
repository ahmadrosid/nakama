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
import type { TranscriptSegment } from "./transcription";

export type MeetingState =
  | "queued"
  | "joining"
  | "transcribing"
  | "finished"
  | "failed";
export interface Meeting {
  actorId: string;
  createdAt: number;
  durationMinutes: number;
  error: string | null;
  id: string;
  profileId: string | null;
  state: MeetingState;
  stopRequested: number;
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
  list(actorId: string | null = null, profileId: string | null = null) {
    return this.db
      .query<
        Meeting,
        [string | null, string | null, string | null, string | null]
      >(
        "SELECT * FROM meetings WHERE (? IS NULL OR actorId=?) AND (? IS NULL OR profileId=?) ORDER BY createdAt DESC LIMIT 100"
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
  recover() {
    this.db
      .query(
        "UPDATE meetings SET state='failed', error='Meeting worker restarted; partial transcript saved',updatedAt=? WHERE state IN ('joining','transcribing')"
      )
      .run(Date.now());
    this.restoreTranscripts(true);
  }
  update(id: string, state: MeetingState, error: string | null = null) {
    this.db
      .query("UPDATE meetings SET state=?,error=?,updatedAt=? WHERE id=?")
      .run(state, error, Date.now(), id);
  }
  stop(id: string) {
    this.db.query("UPDATE meetings SET stopRequested=1 WHERE id=?").run(id);
  }
  addSegment(meetingId: string, segment: TranscriptSegment) {
    if (!this.get(meetingId)) {
      throw new Error("Meeting not found");
    }
    this.db
      .query(
        "INSERT OR IGNORE INTO segments (meetingId,id,text,receivedAt) VALUES (?,?,?,?)"
      )
      .run(meetingId, segment.id, segment.text, segment.receivedAt);
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
          .query<{ text: string }, [string]>(
            "SELECT text FROM segments WHERE meetingId=? ORDER BY sequence"
          )
          .all(id);
        mkdirSync(join(this.directory, "transcripts"), {
          mode: 0o700,
          recursive: true,
        });
        const path = this.transcriptPath(id);
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          writeFileSync(
            temporary,
            rows.map((row) => `${row.text}\n`).join(""),
            { mode: 0o600 }
          );
          renameSync(temporary, path);
        } finally {
          rmSync(temporary, { force: true });
        }
      })
      .immediate();
  }
  transcript(id: string, after = 0) {
    return this.db
      .query<TranscriptSegment & { sequence: number }, [string, number]>(
        "SELECT sequence,id,text,receivedAt FROM segments WHERE meetingId=? AND sequence>? ORDER BY sequence LIMIT 2000"
      )
      .all(id, after);
  }
  close() {
    this.db.close();
  }
}
