import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter, DEFAULT_PROFILE_ID } from "@tinyclaw/db";
import type { StoredProfileRecord } from "@tinyclaw/db";
import { AgentService } from "./agent-service";

function createDefaultProfile(): StoredProfileRecord {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_PROFILE_ID,
    name: "Default",
    systemPrompt: "You are helpful.",
    model: null,
    isSuper: false,
    createdAt: now,
    updatedAt: now,
  };
}

describe("AgentService branching", () => {
  test("branches a new session from the selected message index", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    const sourceSessionId = await service.createSession("web", DEFAULT_PROFILE_ID);
    await db.replaceMessagesForSession(sourceSessionId, [
      {
        id: "msg_1",
        sessionId: sourceSessionId,
        seq: 0,
        payload: { role: "user", content: "Hello" },
        createdAt: "2026-06-14T10:00:00.000Z",
      },
      {
        id: "msg_2",
        sessionId: sourceSessionId,
        seq: 1,
        payload: { role: "assistant", content: "Hi there" },
        createdAt: "2026-06-14T10:00:01.000Z",
      },
      {
        id: "msg_3",
        sessionId: sourceSessionId,
        seq: 2,
        payload: { role: "user", content: "Second turn" },
        createdAt: "2026-06-14T10:00:02.000Z",
      },
    ]);
    await db.updateSessionTitle(sourceSessionId, "Original chat");
    await db.updateSessionTodos(sourceSessionId, [
      { id: "todo_1", content: "Keep this out of the branch", status: "pending" },
    ]);

    const result = await service.branchSession(sourceSessionId, 1);

    expect(result).not.toBeNull();
    const branchSessionId = result!.sessionId;

    const branchMessages = await service.getSessionMessages(branchSessionId);
    expect(branchMessages?.messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);
    expect(branchMessages?.messageMeta).toHaveLength(2);

    const branchTodos = await service.getSessionTodos(branchSessionId);
    expect(branchTodos).toEqual([]);

    const branchRecord = await db.getSession(branchSessionId);
    expect(branchRecord?.profileId).toBe(DEFAULT_PROFILE_ID);
    expect(branchRecord?.channel).toBe("web");
    expect(branchRecord?.title).toBe("Original chat (Branch)");

    const sourceMessages = await service.getSessionMessages(sourceSessionId);
    expect(sourceMessages?.messages).toHaveLength(3);
  });

  test("rejects an out-of-range branch index", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    const sourceSessionId = await service.createSession("web", DEFAULT_PROFILE_ID);
    await db.replaceMessagesForSession(sourceSessionId, [
      {
        id: "msg_1",
        sessionId: sourceSessionId,
        seq: 0,
        payload: { role: "user", content: "Hello" },
        createdAt: "2026-06-14T10:00:00.000Z",
      },
    ]);

    await expect(service.branchSession(sourceSessionId, 3)).rejects.toThrow(
      "messageIndex is out of bounds.",
    );
  });
});
