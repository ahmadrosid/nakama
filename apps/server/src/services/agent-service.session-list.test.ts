import { describe, expect, test } from "bun:test";
import type { StoredProfileRecord } from "@nakama/db";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import { sessionTurnRegistry } from "./session-turn-registry";

const ORG_ID = "org_test";

function createDefaultProfile(): StoredProfileRecord {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    id: "profile_default",
    isDefault: true,
    isSuper: false,
    model: null,
    name: "Default",
    orgId: ORG_ID,
    systemPrompt: "You are helpful.",
    updatedAt: now,
  };
}

async function createService(): Promise<{
  db: ReturnType<typeof createInMemoryDatabaseAdapter>;
  service: AgentService;
}> {
  const db = createInMemoryDatabaseAdapter();
  await db.upsertProfile(createDefaultProfile());
  return { db, service: new AgentService(null, null, db) };
}

/** The list only carries sessions that hold a message, so seed one. */
async function seedFirstMessage(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>,
  sessionId: string
): Promise<void> {
  await db.appendMessagesForSession(sessionId, [
    {
      createdAt: new Date().toISOString(),
      id: `msg_${sessionId}`,
      payload: { content: "hello", role: "user" },
      seq: 0,
      sessionId,
    },
  ]);
}

describe("listSessions reports the live turn", () => {
  setupTestConfigDir("nakama-session-list-");

  test("a session is active only while its turn is running", async () => {
    const { db, service } = await createService();
    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null
    );
    await seedFirstMessage(db, sessionId);

    const idle = await service.listSessions(ORG_ID, "profile_default", "web", {
      isPlatformAdmin: true,
    });
    expect(idle.sessions.map((session) => session.active)).toEqual([false]);

    expect(sessionTurnRegistry.beginTurn(sessionId).started).toBe(true);
    try {
      const running = await service.listSessions(
        ORG_ID,
        "profile_default",
        "web",
        { isPlatformAdmin: true }
      );
      expect(running.sessions.map((session) => session.active)).toEqual([true]);
    } finally {
      sessionTurnRegistry.endTurn(sessionId, { reply: "ok", type: "done" });
    }

    // The sidebar mark has to clear on its own once the turn ends, without the
    // list being invalidated by whoever was watching the stream.
    const settled = await service.listSessions(
      ORG_ID,
      "profile_default",
      "web",
      { isPlatformAdmin: true }
    );
    expect(settled.sessions.map((session) => session.active)).toEqual([false]);
  });
});
