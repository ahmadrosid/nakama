import { describe, expect, test } from "bun:test";
import type { AgentChatSession } from "@nakama/agent";
import type { DatabaseAdapter } from "@nakama/db";
import { wrapPersistedSession } from "./session-persistence";

describe("wrapPersistedSession", () => {
  test("clear leaves the delete to clearSession instead of firing it unawaited", () => {
    let cleared = false;
    const session = {
      clear() {
        cleared = true;
      },
      getHistoryRevision: () => 0,
    } as unknown as AgentChatSession;

    // An unawaited call here rejects with nowhere to report, and Bun ends the
    // process on an unhandled rejection. AgentService.clearSession awaits the
    // same delete right after, so this wrapper must not repeat it.
    const db = {
      deleteMessagesForSession() {
        throw new Error("clear() must not delete messages");
      },
    } as unknown as DatabaseAdapter;

    wrapPersistedSession("session_1", session, db).clear();

    expect(cleared).toBe(true);
  });
});
