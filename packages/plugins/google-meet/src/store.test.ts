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

test("large imports preserve Unicode and paginate below the runner output limit", () => {
  const text = "x".repeat(31_999) + "😀" + '"'.repeat(700_000);
  const active = store.create(meetingUrl, "me", undefined, 1);
  const imported = store.importFile("notes.md", text, "me");
  expect(store.get(active.id)?.state).toBe("queued");
  expect(store.get(imported.id)?.sourceName).toBe("notes.md");
  let cursor = 0;
  let actual = "";
  while (true) {
    const page = store.transcript(imported.id, cursor);
    if (!page.length) {
      break;
    }
    expect(JSON.stringify(page).length).toBeLessThan(510_000);
    actual += page.map((segment) => segment.text).join("");
    cursor = page.at(-1)!.sequence;
  }
  expect(actual).toBe(text);
  expect(
    readFileSync(join(dir, "transcripts", `meeting-${imported.id}.txt`), "utf8")
  ).toBe(text);
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
  expect(store.list("user-a", "profile-a")[0]?.preview).toBe("Hello");
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
  for (let i = 0; i < 100; i++) {
    const other = store.create(own.url, "other", "theirs", 1);
    store.update(other.id, "finished");
  }
  expect(store.list("me", "mine").map((row) => row.id)).toEqual([own.id]);
  expect(store.list("me", "theirs")).toEqual([]);
  expect(store.list(null, "mine").map((row) => row.id)).toEqual([own.id]);
  expect(store.list()).toHaveLength(100);
});

test("upgrades existing meeting databases without losing transcripts", () => {
  const meeting = store.create(meetingUrl, "me", undefined, 1);
  store.addSegment(meeting.id, {
    id: "one",
    receivedAt: 1,
    text: "Launch planning",
  });
  store.update(meeting.id, "finished");
  store.close();
  const db = new Database(join(dir, "meetings.sqlite"));
  db.exec("ALTER TABLE meetings DROP COLUMN title");
  db.close();
  store = new MeetingStore(dir, "org");
  expect(store.nextUntitled()).toEqual({
    id: meeting.id,
    text: "Launch planning",
  });
  store.setTitle(meeting.id, "Launch Plan");
  expect(store.get(meeting.id)?.title).toBe("Launch Plan");
  expect(store.transcript(meeting.id)[0]?.text).toBe("Launch planning");
  expect(store.nextUntitled()).toBeNull();
});

test("speaker turns survive reopen and recording remains an exclusive active state", () => {
  const directory = mkdtempSync(join(tmpdir(), "meet-speaker-store-"));
  let store = new MeetingStore(directory, "org");
  try {
    const meeting = store.create(
      "https://meet.google.com/abc-defg-hij",
      "user",
      undefined,
      1
    );
    store.update(meeting.id, "recording");
    expect(() =>
      store.create("https://meet.google.com/abc-defg-hij", "user", undefined, 1)
    ).toThrow();
    const turn = {
      endMs: 500,
      id: "0-0",
      receivedAt: 1,
      speakerId: "speaker_1",
      speakerName: "Speaker 1",
      startMs: 100,
      text: "Hello",
    };
    store.addSegment(meeting.id, turn);
    store.addSegment(meeting.id, turn);
    store.close();
    store = new MeetingStore(directory, "org");
    expect(store.transcript(meeting.id)).toHaveLength(1);
    expect(store.transcript(meeting.id)[0]).toMatchObject(turn);
    expect(
      readFileSync(
        join(directory, "transcripts", `meeting-${meeting.id}.txt`),
        "utf8"
      )
    ).toBe("Speaker 1: Hello\n");
    store.recover();
    expect(store.get(meeting.id)?.state).toBe("failed");
    expect(store.transcript(meeting.id)[0]?.speakerName).toBe("Speaker 1");
  } finally {
    store.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("caption names enrich matching audio turns without duplicating them", () => {
  const meeting = store.create(meetingUrl, "me", undefined, 1);
  store.addSegment(meeting.id, {
    id: "0-0",
    receivedAt: 1,
    speakerName: "Speaker 1",
    text: "Hello everyone",
  });
  store.addCaptionSegment(meeting.id, {
    id: "caption-1",
    receivedAt: 2,
    speakerName: "Alice",
    text: "Hello everyone",
  });
  expect(store.transcript(meeting.id)).toMatchObject([
    { speakerName: "Alice", text: "Hello everyone" },
  ]);
  store.addCaptionSegment(meeting.id, {
    id: "caption-2",
    receivedAt: 3,
    speakerName: "Bob",
    text: "A new sentence",
  });
  expect(store.transcript(meeting.id)).toHaveLength(2);
});
