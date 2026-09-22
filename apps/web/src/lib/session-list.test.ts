import { describe, expect, test } from "bun:test";
import type { SessionSummary } from "@nakama/core/contract";
import { sessionListPollInterval } from "@/lib/session-list";

const NOW = Date.parse("2026-09-21T12:00:00.000Z");

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    active: false,
    channel: "web",
    createdAt: "2026-09-21T11:00:00.000Z",
    id: "session_1",
    messageCount: 2,
    pinned: false,
    preview: null,
    profileId: "default",
    title: "Titled chat",
    updatedAt: "2026-09-21T11:59:00.000Z",
    ...overrides,
  };
}

describe("sessionListPollInterval", () => {
  test("polls while a turn is running", () => {
    expect(
      sessionListPollInterval([session({ active: true })], { now: NOW })
    ).toBe(2000);
  });

  test("polls while a recent session is still waiting for its title", () => {
    expect(
      sessionListPollInterval([session({ title: null })], { now: NOW })
    ).toBe(2000);
  });

  test("goes quiet once every session is titled and idle", () => {
    expect(sessionListPollInterval([session(), session()], { now: NOW })).toBe(
      false
    );
  });

  test("stops waiting on a title that never arrived", () => {
    // Title generation can fail. Without the bound this one session would keep
    // the whole list polling for the life of the tab.
    const stale = session({
      title: null,
      updatedAt: "2026-09-21T11:50:00.000Z",
    });

    expect(sessionListPollInterval([stale], { now: NOW })).toBe(false);
  });

  test("treats an unparsable timestamp as not worth waiting for", () => {
    const broken = session({ title: null, updatedAt: "not a date" });

    expect(sessionListPollInterval([broken], { now: NOW })).toBe(false);
  });

  test("is quiet with no sessions loaded yet", () => {
    expect(sessionListPollInterval(undefined, { now: NOW })).toBe(false);
    expect(sessionListPollInterval([], { now: NOW })).toBe(false);
  });

  test("polls for a turn this tab just started, before the list has a row for it", () => {
    // A brand new chat has no row until its first message is stored, so there
    // is nothing in the data to notice. Only the caller knows.
    expect(sessionListPollInterval([], { localTurn: true, now: NOW })).toBe(
      2000
    );
    expect(
      sessionListPollInterval(undefined, { localTurn: true, now: NOW })
    ).toBe(2000);
  });

  test("a local turn outranks an otherwise quiet list", () => {
    expect(
      sessionListPollInterval([session()], { localTurn: true, now: NOW })
    ).toBe(2000);
  });
});
