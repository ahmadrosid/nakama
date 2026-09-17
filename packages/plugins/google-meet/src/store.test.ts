import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeetingStore } from "./store";

let dir: string;
let store: MeetingStore;
const meetingUrl = "https://meet.google.com/abc-defg-hij";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "meet-store-"));
  store = new MeetingStore(dir, "org");
});

afterEach(() => {
  store.close();
  rmSync(dir, { force: true, recursive: true });
});

test("one active meeting per org, transcripts survive closing and cannot cross tenants", () => {
  const meeting = store.create(meetingUrl, "user-a", "profile-a", 30);
  expect(() =>
    store.create(
      "https://meet.google.com/xyz-abcd-efg",
      "user-a",
      "profile-a",
      30
    )
  ).toThrow();
  store.addSegment(meeting.id, {
    id: "turn-1",
    receivedAt: 123,
    text: "Hello",
  });
  store.addSegment(meeting.id, {
    id: "turn-1",
    receivedAt: 123,
    text: "Hello",
  });
  expect(store.transcript(meeting.id)).toHaveLength(1);
  const file = join(dir, "transcripts", `meeting-${meeting.id}.txt`);
  expect(readFileSync(file, "utf8")).toBe("Hello\n");
  expect(statSync(file).mode % 0o1000).toBe(0o600);
  expect(store.list("user-a", "profile-a")[0]?.transcriptFile).toBe(
    `meeting-${meeting.id}.txt`
  );
  expect(() => new MeetingStore(dir, "org-b")).toThrow();
  store.update(meeting.id, "finished");
  expect(
    store.create(
      "https://meet.google.com/xyz-abcd-efg",
      "user-a",
      undefined,
      30
    ).id
  ).not.toBe(meeting.id);
});

test("legacy export includes every segment beyond the transcript page limit", () => {
  const meeting = store.create(meetingUrl, "me", undefined, 1);
  store.close();
  const db = new Database(join(dir, "meetings.sqlite"));
  try {
    db.transaction(() => {
      const insert = db.query(
        "INSERT INTO segments (meetingId,id,text,receivedAt) VALUES (?,?,?,?)"
      );
      for (let i = 0; i < 2001; i++) {
        insert.run(meeting.id, String(i), `Line ${i}`, i);
      }
    })();
  } finally {
    db.close();
  }
  store = new MeetingStore(dir, "org");
  const text = readFileSync(
    join(dir, "transcripts", `meeting-${meeting.id}.txt`),
    "utf8"
  );
  expect(text.split("\n")).toHaveLength(2002);
  expect(text.endsWith("Line 2000\n")).toBe(true);
});

test("existing transcripts are exported on reopen and recovery repairs partial files", () => {
  const meeting = store.create(meetingUrl, "me", undefined, 1);
  store.addSegment(meeting.id, { id: "one", receivedAt: 1, text: "First" });
  store.addSegment(meeting.id, { id: "two", receivedAt: 2, text: "Second" });
  const file = join(dir, "transcripts", `meeting-${meeting.id}.txt`);
  expect(readFileSync(file, "utf8")).toBe("First\nSecond\n");
  store.update(meeting.id, "transcribing");
  store.close();
  rmSync(file);
  store = new MeetingStore(dir, "org");
  expect(readFileSync(file, "utf8")).toBe("First\nSecond\n");
  writeFileSync(file, "First\n");
  store.recover();
  expect(store.get(meeting.id)?.state).toBe("failed");
  expect(readFileSync(file, "utf8")).toBe("First\nSecond\n");
  expect(store.list("someone-else")).toEqual([]);
});

test("a failed file export preserves database speech for recovery", () => {
  const meeting = store.create(meetingUrl, "me", undefined, 1);
  writeFileSync(join(dir, "transcripts"), "blocked directory");
  expect(() =>
    store.addSegment(meeting.id, {
      id: "one",
      receivedAt: 1,
      text: "Keep this",
    })
  ).toThrow();
  expect(store.transcript(meeting.id)[0]?.text).toBe("Keep this");
  rmSync(join(dir, "transcripts"));
  store.recover();
  expect(
    readFileSync(join(dir, "transcripts", `meeting-${meeting.id}.txt`), "utf8")
  ).toBe("Keep this\n");
});

test("rejects arbitrary URLs and invalid durations before queuing a browser", () => {
  for (const url of [
    "http://meet.google.com/abc-defg-hij",
    "https://evil.com",
    "https://meet.google.com@evil.com/abc-defg-hij",
  ]) {
    expect(() => store.create(url, "user", undefined, 30)).toThrow();
  }
  expect(() => store.create(meetingUrl, "user", undefined, 0)).toThrow();
  expect(() => store.create(meetingUrl, "user", undefined, 121)).toThrow();
  expect(store.create(meetingUrl, "user", undefined, 120).durationMinutes).toBe(
    120
  );
});

test("history limits apply after actor and profile access filters", () => {
  const own = store.create(meetingUrl, "me", "mine", 1);
  store.update(own.id, "finished");
  for (let i = 0; i < 101; i++) {
    const other = store.create(own.url, "other", "theirs", 1);
    store.update(other.id, "finished");
  }
  expect(store.list("me", "mine").map((row) => row.id)).toEqual([own.id]);
  expect(store.list("me", "theirs")).toEqual([]);
  expect(store.list(null, "mine").map((row) => row.id)).toEqual([own.id]);
  expect(store.list()).toHaveLength(100);
});
