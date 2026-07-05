import { describe, expect, test } from "bun:test";
import {
  createInMemoryDatabaseAdapter,
  createSqliteDatabase,
  WORKSPACE_SETTINGS_ID,
} from "@tinyclaw/db";
import type { StoredProfileRecord } from "@tinyclaw/db";
import { AgentService } from "./agent-service";

const ORG_ID = "org_test";

function createDefaultProfile(): StoredProfileRecord {
  const now = new Date().toISOString();
  return {
    id: "profile_default",
    name: "Default",
    systemPrompt: "You are helpful.",
    model: null,
    isSuper: false,
    orgId: ORG_ID,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

describe("AgentService branching", () => {
  test("branches a new session from the selected message index", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    const sourceSessionId = await service.createSession(ORG_ID, "web", "profile_default");
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
    await db.updateSessionQuestionnaire(sourceSessionId, {
      id: "q_1",
      title: "Need input",
      questions: [
        {
          id: "timeline",
          prompt: "When?",
          allowCustomAnswer: true,
          choices: [],
        },
      ],
    });

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
    expect(await service.getSessionQuestionnaire(branchSessionId)).toBeNull();

    const branchRecord = await db.getSession(branchSessionId);
    expect(branchRecord?.profileId).toBe("profile_default");
    expect(branchRecord?.channel).toBe("web");
    expect(branchRecord?.title).toBe("Original chat (Branch)");

    const sourceMessages = await service.getSessionMessages(sourceSessionId);
    expect(sourceMessages?.messages).toHaveLength(3);
  });

  test("rejects an out-of-range branch index", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    const sourceSessionId = await service.createSession(ORG_ID, "web", "profile_default");
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

  test("falls back to org default when the requested profile is missing", async () => {
    const database = await createSqliteDatabase(":memory:");
    const db = database.adapter;
    const now = new Date().toISOString();

    try {
      await db.upsertOrganization({
        id: ORG_ID,
        name: "Test Org",
        slug: "test-org",
        createdAt: now,
        updatedAt: now,
      });

      await db.upsertProfile({
        id: "profile_custom",
        name: "Custom",
        systemPrompt: "You are helpful.",
        model: null,
        isSuper: false,
        orgId: ORG_ID,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });

      const service = new AgentService(null, null, db);
      const sessionId = await service.createSession(ORG_ID, "web", "missing_profile");
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

describe("AgentService vision settings", () => {
  test("persists vision model in the database", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new AgentService(
      {
        defaultProviderId: "p-openai-1",
        providers: [
          {
            id: "p-openai-1",
            type: "openai",
            label: "OpenAI",
            apiKey: "test-key",
            createdAt: new Date().toISOString(),
          },
        ],
      },
      null,
      db,
    );

    const saved = await service.setVisionSettings({ model: "p-openai-1::gpt-4o-mini" });

    expect(saved).toEqual({ vision: { model: "p-openai-1::gpt-4o-mini" } });
    expect(await db.getWorkspaceSettings()).toMatchObject({
      visionModel: "p-openai-1::gpt-4o-mini",
      transcriptionModel: null,
    });
    expect(await service.getVisionSettings()).toEqual({
      vision: { model: "p-openai-1::gpt-4o-mini" },
    });
  });
});

describe("AgentService transcription settings", () => {
  test("persists transcription model in the database", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new AgentService(
      {
        defaultProviderId: "p-openai-1",
        providers: [
          {
            id: "p-openai-1",
            type: "openai",
            label: "OpenAI",
            apiKey: "test-key",
            createdAt: new Date().toISOString(),
          },
        ],
      },
      null,
      db,
    );

    const saved = await service.setTranscriptionSettings({ model: "p-openai-1::whisper-1" });

    expect(saved).toEqual({ transcription: { model: "p-openai-1::whisper-1" } });
    expect(await db.getWorkspaceSettings()).toMatchObject({
      transcriptionModel: "p-openai-1::whisper-1",
    });
    expect(await service.getTranscriptionSettings()).toEqual({
      transcription: { model: "p-openai-1::whisper-1" },
    });
  });
});

describe("AgentService coding delegation context", () => {
  test("includes the selected harness name in the coding delegation context", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      id: WORKSPACE_SETTINGS_ID,
      visionModel: null,
      transcriptionModel: null,
      codingAgentHarnesses: [
        {
          id: "coding-harness-opencode",
          kind: "opencode",
          name: "OpenCode",
          command: "opencode",
          args: [],
          enabled: true,
        },
      ],
      selectedCodingAgentHarness: "coding-harness-opencode",
      updatedAt: new Date().toISOString(),
    });

    const service = new AgentService(null, null, db);
    const context = await (service as unknown as {
      formatCodingDelegationContext(): Promise<string>;
    }).formatCodingDelegationContext();

    expect(context).toContain("The selected coding agent harness is OpenCode");
    expect(context).toContain("delegate_coding_task");
  });

  test("falls back gracefully when no harness is selected", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertWorkspaceSettings({
      id: WORKSPACE_SETTINGS_ID,
      visionModel: null,
      transcriptionModel: null,
      codingAgentHarnesses: [],
      selectedCodingAgentHarness: null,
      updatedAt: new Date().toISOString(),
    });

    const service = new AgentService(null, null, db);
    const context = await (service as unknown as {
      formatCodingDelegationContext(): Promise<string>;
    }).formatCodingDelegationContext();

    expect(context).toContain("No coding agent harness is selected");
    expect(context).toContain("delegate_coding_task");
  });
});
