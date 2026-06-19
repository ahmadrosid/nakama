import { describe, expect, test } from "bun:test";
import {
  createInMemoryDatabaseAdapter,
  createSqliteDatabase,
  DEFAULT_PROFILE_ID,
} from "@tinyclaw/db";
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

  test("falls back to an existing profile when the requested profile is missing", async () => {
    const database = await createSqliteDatabase(":memory:");
    const db = database.adapter;
    const now = new Date().toISOString();

    try {
      await db.upsertProfile({
        id: "profile_custom",
        name: "Custom",
        systemPrompt: "You are helpful.",
        model: null,
        isSuper: false,
        createdAt: now,
        updatedAt: now,
      });

      const service = new AgentService(null, null, db);
      const sessionId = await service.createSession("web", "missing_profile");
      const session = await db.getSession(sessionId);

      expect(session?.profileId).toBe("profile_custom");
    } finally {
      database.close();
    }
  });
});

describe("AgentService thinking provider options", () => {
  test("keeps thinking enabled for openai-compatible providers", () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new AgentService(
      {
        defaultProviderId: "compat-1",
        providers: [
          {
            id: "compat-1",
            type: "openai_compatible",
            label: "NetraRuntime",
            apiKey: "",
            baseUrl: "https://api.example.com/v1",
            customModels: [{ id: "qwen3.6-35b", default: true, supportsThinking: true }],
            createdAt: new Date().toISOString(),
          },
        ],
        thinkingEnabled: true,
        thinkingEffort: "high",
      },
      null,
      db,
    );

    const options = (service as unknown as {
      resolveChatProviderOptions: (
        providerInstance: {
          type: "openai_compatible";
          id: string;
          label: string;
          apiKey: string;
          baseUrl: string;
          createdAt: string;
        },
        thinkingSettings: { enabled: boolean; effort: "low" | "medium" | "high" },
      ) => { thinking?: { enabled: boolean; effort: string } } | undefined;
    }).resolveChatProviderOptions(
      {
        id: "compat-1",
        type: "openai_compatible",
        label: "NetraRuntime",
        apiKey: "",
        baseUrl: "https://api.example.com/v1",
        createdAt: new Date().toISOString(),
      },
      { enabled: true, effort: "high" },
    );

    expect(options?.thinking).toEqual({ enabled: true, effort: "high" });
  });
});
