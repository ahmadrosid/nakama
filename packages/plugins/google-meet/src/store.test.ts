import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeetingStore } from "./store";

test("one active meeting per org, transcripts survive closing and cannot cross tenants", () => {
  const dir = mkdtempSync(join(tmpdir(), "meet-store-"));
  const store = new MeetingStore(dir, "org-a");
  try {
    const meeting = store.create(
      "https://meet.google.com/abc-defg-hij",
      "user-a",
      "profile-a",
      30
    );
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
  } finally {
    store.close();
    rmSync(dir, { force: true, recursive: true });
  }
});

test("rejects arbitrary URLs and invalid durations before queuing a browser", () => {
  const dir = mkdtempSync(join(tmpdir(), "meet-store-"));
  const store = new MeetingStore(dir, "org-a");
  try {
    for (const url of [
      "http://meet.google.com/abc-defg-hij",
      "https://evil.com",
      "https://meet.google.com@evil.com/abc-defg-hij",
    ]) {
      expect(() => store.create(url, "user", undefined, 30)).toThrow();
    }
    expect(() =>
      store.create("https://meet.google.com/abc-defg-hij", "user", undefined, 0)
    ).toThrow();
  } finally {
    store.close();
    rmSync(dir, { force: true, recursive: true });
  }
});

test("history limits apply after actor and profile access filters", () => {
  const dir = mkdtempSync(join(tmpdir(), "meet-history-"));
  const store = new MeetingStore(dir, "org");
  try {
    const own = store.create(
      "https://meet.google.com/abc-defg-hij",
      "me",
      "mine",
      1
    );
    store.update(own.id, "finished");
    for (let i = 0; i < 101; i++) {
      const other = store.create(own.url, "other", "theirs", 1);
      store.update(other.id, "finished");
    }
    expect(store.list("me", "mine").map((row) => row.id)).toEqual([own.id]);
    expect(store.list("me", "theirs")).toEqual([]);
    expect(store.list(null, "mine").map((row) => row.id)).toEqual([own.id]);
    expect(store.list()).toHaveLength(100);
  } finally {
    store.close();
    rmSync(dir, { force: true, recursive: true });
  }
});
