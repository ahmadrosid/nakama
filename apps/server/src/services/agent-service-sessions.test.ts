import { describe, expect, test } from "bun:test";
import type { ProviderInstance } from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  createSqliteDatabase,
} from "@nakama/db";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";
import { sessionTurnRegistry } from "./session-turn-registry";

const ORG_ID = "org_test";

interface AgentServiceProviderOptionsAccess {
  resolveChatProviderOptions: (
    providerInstance: ProviderInstance,
    thinkingSettings: { enabled: boolean; effort: "low" | "medium" | "high" }
  ) => { thinking?: { enabled: boolean; effort: string } } | undefined;
}

function privateServiceAccess<T>(service: AgentService): T {
  // SAFETY: Tests use named interfaces for private service members.
  return Object.create(service) as T;
}

describe("AgentService branching", () => {
  test("reopens a saved session with a retired ChatGPT model", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());

    const sessionId = await new AgentService(null, null, db).createSession(
      ORG_ID,
      "web",
      "profile_default"
    );

    await db.updateSessionModel(sessionId, "chatgpt-1::gpt-5.4-mini");

    const service = new AgentService(
      {
        defaultProviderId: "chatgpt-1",
        providers: [
          {
            apiKey: "",
            createdAt: "2026-09-16T00:00:00.000Z",
            id: "chatgpt-1",
            label: "ChatGPT",
            type: "chatgpt",
          },
        ],
      },
      null,
      db
    );

    expect((await service.getSessionMessages(sessionId, ORG_ID))?.model).toBe(
      "chatgpt-1::gpt-5.4-mini"
    );
    expect((await db.getSession(sessionId))?.model).toBe(
      "chatgpt-1::gpt-5.4-mini"
    );
  });

  test("keeps model selection scoped to the chat session", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({
      ...createDefaultProfile(),
      model: "provider-1::profile-default",
    });

    const service = new AgentService(
      {
        defaultProviderId: "provider-1",
        providers: [
          {
            apiKey: "",
            baseUrl: "https://api.example.com/v1",
            createdAt: new Date().toISOString(),
            customModels: [
              { default: true, id: "profile-default" },
              { id: "chat-model" },
              { id: "next-chat-model" },
            ],
            id: "provider-1",
            label: "Test provider",
            type: "openai_compatible",
          },
        ],
      },
      null,
      db
    );

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null,
      { model: "provider-1::chat-model" }
    );

    expect((await db.getProfile("profile_default"))?.model).toBe(
      "provider-1::profile-default"
    );
    expect((await db.getSession(sessionId))?.model).toBe(
      "provider-1::chat-model"
    );
    expect((await service.getSessionMessages(sessionId, ORG_ID))?.model).toBe(
      "provider-1::chat-model"
    );

    sessionTurnRegistry.beginTurn(sessionId);
    await expect(
      service.updateSessionModel(
        sessionId,
        ORG_ID,
        "provider-1::next-chat-model"
      )
    ).rejects.toThrow("Wait for the current response");
    sessionTurnRegistry.cancelTurn(sessionId);
    expect((await db.getSession(sessionId))?.model).toBe(
      "provider-1::chat-model"
    );

    expect(
      await service.updateSessionModel(
        sessionId,
        ORG_ID,
        "provider-1::next-chat-model"
      )
    ).toBe(true);
    expect((await db.getSession(sessionId))?.model).toBe(
      "provider-1::next-chat-model"
    );
    await expect(
      service.updateSessionModel(sessionId, ORG_ID, "provider-1::unknown")
    ).rejects.toThrow("Select a configured model");
    expect((await db.getSession(sessionId))?.model).toBe(
      "provider-1::next-chat-model"
    );
    await db.replaceMessagesForSession(sessionId, [
      {
        createdAt: "2026-08-25T00:00:00.000Z",
        id: "msg_session_model",
        payload: { content: "Keep the chat model", role: "user" },
        seq: 0,
        sessionId,
      },
    ]);

    const branch = await service.branchSession(sessionId, 0, ORG_ID);
    expect(branch).not.toBeNull();
    expect((await db.getSession(branch!.sessionId))?.model).toBe(
      "provider-1::next-chat-model"
    );

    expect(await service.updateSessionModel(sessionId, ORG_ID, null)).toBe(
      true
    );
    expect((await db.getSession(sessionId))?.model).toBeNull();
  });

  test("keeps thinking effort scoped to the chat session", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile({
      ...createDefaultProfile(),
      model: "provider-1::thinker",
    });

    const service = new AgentService(
      {
        defaultProviderId: "provider-1",
        providers: [
          {
            apiKey: "",
            baseUrl: "https://api.example.com/v1",
            createdAt: new Date().toISOString(),
            customModels: [
              { default: true, id: "thinker", supportsThinking: true },
            ],
            id: "provider-1",
            label: "Test provider",
            type: "openai_compatible",
          },
        ],
        thinkingEffort: "medium",
        thinkingEnabled: true,
      },
      null,
      db
    );

    const builtEfforts: string[] = [];

    const { resolveChatProviderOptions } =
      privateServiceAccess<AgentServiceProviderOptionsAccess>(service);

    Object.defineProperty(service, "resolveChatProviderOptions", {
      value: (
        ...args: Parameters<typeof resolveChatProviderOptions>
      ): ReturnType<typeof resolveChatProviderOptions> => {
        builtEfforts.push(args[1].effort);

        return resolveChatProviderOptions.apply(service, args);
      },
    });

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null,
      { thinkingEffort: "low" }
    );

    expect((await db.getSession(sessionId))?.thinkingEffort).toBe("low");
    expect(builtEfforts.at(-1)).toBe("low");
    expect(
      (await service.getSessionMessages(sessionId, ORG_ID))?.thinkingEffort
    ).toBe("low");

    sessionTurnRegistry.beginTurn(sessionId);
    await expect(
      service.updateSessionThinkingEffort(sessionId, ORG_ID, "high")
    ).rejects.toThrow("Wait for the current response");
    sessionTurnRegistry.cancelTurn(sessionId);
    expect((await db.getSession(sessionId))?.thinkingEffort).toBe("low");

    expect(
      await service.updateSessionThinkingEffort(sessionId, ORG_ID, "high")
    ).toBe(true);
    expect((await db.getSession(sessionId))?.thinkingEffort).toBe("high");
    await service.getSessionMessages(sessionId, ORG_ID);
    expect(builtEfforts.at(-1)).toBe("high");

    expect(
      await service.updateSessionThinkingEffort(sessionId, ORG_ID, null)
    ).toBe(true);
    expect((await db.getSession(sessionId))?.thinkingEffort).toBeNull();
    await service.getSessionMessages(sessionId, ORG_ID);
    expect(builtEfforts.at(-1)).toBe("medium");
  });

  test("branches a new session from the selected message index", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    const sourceSessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default"
    );

    await db.replaceMessagesForSession(sourceSessionId, [
      {
        createdAt: "2026-06-14T10:00:00.000Z",
        id: "msg_1",
        payload: { content: "Hello", role: "user" },
        seq: 0,
        sessionId: sourceSessionId,
      },
      {
        createdAt: "2026-06-14T10:00:01.000Z",
        id: "msg_2",
        payload: { content: "Hi there", role: "assistant" },
        seq: 1,
        sessionId: sourceSessionId,
      },
      {
        createdAt: "2026-06-14T10:00:02.000Z",
        id: "msg_3",
        payload: { content: "Second turn", role: "user" },
        seq: 2,
        sessionId: sourceSessionId,
      },
    ]);
    await db.updateSessionTitle(sourceSessionId, "Original chat");
    await db.updateSessionTodos(sourceSessionId, [
      {
        content: "Keep this out of the branch",
        id: "todo_1",
        status: "pending",
      },
    ]);
    await db.updateSessionQuestionnaire(sourceSessionId, {
      id: "q_1",
      questions: [
        {
          allowCustomAnswer: true,
          choices: [],
          id: "timeline",
          prompt: "When?",
        },
      ],
      title: "Need input",
    });

    const result = await service.branchSession(sourceSessionId, 1, ORG_ID);

    expect(result).not.toBeNull();
    const branchSessionId = result!.sessionId;

    const branchMessages = await service.getSessionMessages(
      branchSessionId,
      ORG_ID
    );

    expect(branchMessages?.messages).toEqual([
      { content: "Hello", role: "user" },
      { content: "Hi there", role: "assistant" },
    ]);
    expect(branchMessages?.messageMeta).toHaveLength(2);
    expect(
      branchMessages?.messageMeta.map((message) => message.createdAt)
    ).toEqual(["2026-06-14T10:00:00.000Z", "2026-06-14T10:00:01.000Z"]);

    const branchTodos = await service.getSessionTodos(branchSessionId, ORG_ID);
    expect(branchTodos).toEqual([]);
    expect(
      await service.getSessionQuestionnaire(branchSessionId, ORG_ID)
    ).toBeNull();

    const branchRecord = await db.getSession(branchSessionId);
    expect(branchRecord?.profileId).toBe("profile_default");
    expect(branchRecord?.channel).toBe("web");
    expect(branchRecord?.title).toBe("Original chat (Branch)");
    expect(branchRecord?.parentSessionId).toBe(sourceSessionId);
    expect(branchRecord?.branchMessageIndex).toBe(1);

    const sourceMessages = await service.getSessionMessages(
      sourceSessionId,
      ORG_ID
    );

    expect(sourceMessages?.messages).toHaveLength(3);

    await db.deleteSession(sourceSessionId);
    expect((await db.getSession(branchSessionId))?.parentSessionId).toBeNull();
    expect(
      (await service.getSessionMessages(branchSessionId, ORG_ID))?.messages
    ).toHaveLength(2);
  });

  test("detaches a branch without losing its messages", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    const sourceId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default"
    );

    await db.appendMessagesForSession(sourceId, [
      {
        createdAt: "2026-06-14T10:00:00.000Z",
        id: "msg_detach",
        payload: { content: "Keep this", role: "user" },
        seq: 0,
        sessionId: sourceId,
      },
    ]);

    const branchId = (await service.branchSession(sourceId, 0, ORG_ID))!
      .sessionId;

    expect((await db.getSession(branchId))?.parentSessionId).toBe(sourceId);
    expect(await service.detachSession(branchId, ORG_ID)).toBe(true);
    expect((await db.getSession(branchId))?.parentSessionId).toBeNull();
    expect(
      (await service.getSessionMessages(branchId, ORG_ID))?.messages
    ).toEqual([{ content: "Keep this", role: "user" }]);
  });

  test("rejects an out-of-range branch index", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    const sourceSessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default"
    );

    await db.replaceMessagesForSession(sourceSessionId, [
      {
        createdAt: "2026-06-14T10:00:00.000Z",
        id: "msg_1",
        payload: { content: "Hello", role: "user" },
        seq: 0,
        sessionId: sourceSessionId,
      },
    ]);

    await expect(
      service.branchSession(sourceSessionId, 3, ORG_ID)
    ).rejects.toThrow("messageIndex is out of bounds.");
  });

  test("falls back to org default only when no profile is requested", async () => {
    const database = await createSqliteDatabase(":memory:");
    const db = database.adapter;
    const now = new Date().toISOString();

    try {
      await db.upsertOrganization({
        createdAt: now,
        id: ORG_ID,
        name: "Test Org",
        slug: "test-org",
        updatedAt: now,
      });

      await db.upsertProfile({
        createdAt: now,
        id: "profile_custom",
        isDefault: true,
        isSuper: false,
        model: null,
        name: "Custom",
        orgId: ORG_ID,
        systemPrompt: "You are helpful.",
        updatedAt: now,
      });

      const service = new AgentService(null, null, db);
      await expect(
        service.createSession(ORG_ID, "web", "missing_profile")
      ).rejects.toMatchObject({ status: 404 });
      expect(await db.listSessions()).toEqual([]);

      const sessionId = await service.createSession(ORG_ID, "web");
      const session = await db.getSession(sessionId);

      expect(session?.profileId).toBe("profile_custom");
    } finally {
      database.close();
    }
  });
});

describe("AgentService session org scope", () => {
  test("by-id reads return null for a session in another org", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    await db.upsertProfile({
      ...createDefaultProfile(),
      id: "profile_other",
      isDefault: false,
      name: "Other",
      orgId: "org_other",
    });
    const service = new AgentService(null, null, db);

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default"
    );

    expect(await service.getSessionMessages(sessionId, "org_other")).toBeNull();
    expect(await service.resolveSession(sessionId, "org_other")).toBeNull();
    expect(await service.purgeSession(sessionId, "org_other")).toBe(false);
    expect(await db.getSession(sessionId)).not.toBeNull();
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
            apiKey: "",
            baseUrl: "https://api.example.com/v1",
            createdAt: new Date().toISOString(),
            customModels: [
              { default: true, id: "qwen3.6-35b", supportsThinking: true },
            ],
            id: "compat-1",
            label: "NetraRuntime",
            type: "openai_compatible",
          },
        ],
        thinkingEffort: "high",
        thinkingEnabled: true,
      },
      null,
      db
    );

    // SAFETY: The test supplies valid provider and thinking values below.
    const options = privateServiceAccess<AgentServiceProviderOptionsAccess>(
      service
    ).resolveChatProviderOptions(
      {
        apiKey: "",
        baseUrl: "https://api.example.com/v1",
        createdAt: new Date().toISOString(),
        id: "compat-1",
        label: "NetraRuntime",
        type: "openai_compatible",
      },
      { effort: "high", enabled: true }
    );

    expect(options?.thinking).toEqual({ effort: "high", enabled: true });
  });
});
