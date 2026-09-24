import { describe, expect, test } from "bun:test";
import type { SessionSummary } from "@nakama/core/contract";
import {
  sessionListPollInterval,
  sessionSearchQuery,
  withFirstPage,
} from "@/lib/session-list";

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

describe("withFirstPage", () => {
  const loaded = {
    pageParams: [null, "cursor_a"],
    pages: [
      { nextCursor: "cursor_a", sessions: [session({ title: null })] },
      { nextCursor: null, sessions: [session({ id: "session_2" })] },
    ],
  };

  test("swaps in a first page that still ends where the second one starts", () => {
    const head = { nextCursor: "cursor_a", sessions: [session()] };
    expect(withFirstPage(loaded, head)).toEqual({
      pageParams: loaded.pageParams,
      pages: [head, loaded.pages[1]],
    });
  });

  test("gives up when a chat crossed the end of the first page", () => {
    const head = { nextCursor: "cursor_b", sessions: [session()] };
    expect(withFirstPage(loaded, head)).toBeNull();
  });

  test("a single loaded page has nothing to line up with", () => {
    const head = { nextCursor: "cursor_b", sessions: [session()] };
    const single = { pageParams: [null], pages: [loaded.pages[0]] };
    expect(withFirstPage(single, head)?.pages).toEqual([head]);
  });
});

describe("sessionSearchQuery", () => {
  test("keeps 200 characters and cuts the 201st", () => {
    expect(sessionSearchQuery("x".repeat(200))).toBe("x".repeat(200));
    expect(sessionSearchQuery("x".repeat(201))).toBe("x".repeat(200));
  });

  test("trims before it counts, and after it cuts", () => {
    expect(sessionSearchQuery(`   ${"x".repeat(200)}   `)).toBe(
      "x".repeat(200)
    );
    expect(sessionSearchQuery(`${"x".repeat(199)} y`)).toBe("x".repeat(199));
    expect(sessionSearchQuery("   ")).toBe("");
  });
});
