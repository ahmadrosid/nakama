import { describe, expect, test } from "bun:test";
import type { AgentChatSession } from "@nakama/agent";
import type { StoredSessionRecord } from "@nakama/db";
import {
  type EphemeralSession,
  EphemeralSessionStore,
} from "./ephemeral-session-store";

const HOUR_MS = 60 * 60 * 1000;

function entry(id: string, lastActiveAt: number): EphemeralSession {
  return {
    attachmentIds: new Set<string>(),
    lastActiveAt,
    record: { id } as StoredSessionRecord,
    session: {} as AgentChatSession,
  };
}

describe("EphemeralSessionStore", () => {
  test("evicts entries past the idle threshold and keeps the rest", async () => {
    const evicted: string[] = [];
    const store = new EphemeralSessionStore((session) => {
      evicted.push(session.record.id);
      return Promise.resolve();
    });
    const now = Date.now();

    await store.set(entry("stale", now - 13 * HOUR_MS));
    await store.set(entry("fresh", now - HOUR_MS));

    await store.evictIdle(now);

    expect(evicted).toEqual(["stale"]);
    expect(store.has("stale")).toBe(false);
    expect(store.has("fresh")).toBe(true);
  });

  test("a new session collects what an abandoned one left behind", async () => {
    const evicted: string[] = [];
    const store = new EphemeralSessionStore((session) => {
      evicted.push(session.record.id);
      return Promise.resolve();
    });

    await store.set(entry("abandoned", Date.now() - 13 * HOUR_MS));
    // This is the whole eviction trigger now that there is no timer.
    await store.set(entry("new", Date.now()));

    expect(evicted).toEqual(["abandoned"]);
    expect(store.has("new")).toBe(true);
  });

  test("deleting runs the purge once and only once", async () => {
    const evicted: string[] = [];
    const store = new EphemeralSessionStore((session) => {
      evicted.push(session.record.id);
      return Promise.resolve();
    });

    await store.set(entry("one", Date.now()));

    expect(await store.delete("one")).toBe(true);
    expect(await store.delete("one")).toBe(false);
    expect(evicted).toEqual(["one"]);
  });
});
