import { describe, expect, test } from "bun:test";
import type { GenerateChatInput } from "@nakama/core";
import type { StoredProfileRecord } from "@nakama/db";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";

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

/** Answers every turn with a fixed string, no tools. */
function stubHarness(service: AgentService, reply = "Answered"): void {
  const answer = {
    assistantMessage: { content: reply, role: "assistant", toolCalls: [] },
    content: reply,
    toolCalls: [],
  };
  Object.assign(service, {
    _providerConfigured: true,
    createHarnessForProfile: () => ({
      provider: {
        generateChat(_input: GenerateChatInput) {
          return Promise.resolve(answer);
        },
        name: "openai",
        streamChat(_input: GenerateChatInput) {
          return Promise.resolve(answer);
        },
      },
    }),
  });
}

async function createService(): Promise<{
  db: ReturnType<typeof createInMemoryDatabaseAdapter>;
  service: AgentService;
}> {
  const db = createInMemoryDatabaseAdapter();
  await db.upsertProfile(createDefaultProfile());
  const service = new AgentService(null, null, db);
  stubHarness(service);
  return { db, service };
}

describe("cognito sessions are never persisted", () => {
  setupTestConfigDir("nakama-cognito-");

  test("a turn writes no session row and no messages", async () => {
    const { db, service } = await createService();

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null,
      { cognito: { personalized: true } }
    );

    const session = await service.resolveSession(sessionId, ORG_ID);
    expect(session).not.toBeNull();
    await session?.send({ message: "remember my api key" });

    expect(await db.getSession(sessionId)).toBeNull();
    expect(await db.listMessagesForSession(sessionId)).toEqual([]);
    expect(await db.listSessions()).toEqual([]);
  });

  test("the turn is still readable while the session is alive", async () => {
    const { service } = await createService();

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null,
      { cognito: { personalized: true } }
    );
    const session = await service.resolveSession(sessionId, ORG_ID);
    await session?.send({ message: "hello" });

    const result = await service.getSessionMessages(sessionId, ORG_ID);
    expect(result?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(result?.profileId).toBe("profile_default");
  });

  test("an ordinary session still persists", async () => {
    const { db, service } = await createService();

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null
    );
    const session = await service.resolveSession(sessionId, ORG_ID);
    await session?.send({ message: "hello" });

    expect(await db.getSession(sessionId)).not.toBeNull();
    expect((await db.listMessagesForSession(sessionId)).length).toBe(2);
    expect((await db.listSessions()).length).toBe(1);
  });

  test("resolveSession returns the same object so history is never rebuilt", async () => {
    const { service } = await createService();

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null,
      { cognito: { personalized: false } }
    );

    const first = await service.resolveSession(sessionId, ORG_ID);
    await first?.send({ message: "hello" });
    const second = await service.resolveSession(sessionId, ORG_ID);

    expect(second).toBe(first);
    expect(second?.getHistory().length).toBe(2);
  });

  test("deleting a cognito session makes it unreachable", async () => {
    const { service } = await createService();

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null,
      { cognito: { personalized: true } }
    );
    const session = await service.resolveSession(sessionId, ORG_ID);
    await session?.send({ message: "hello" });

    expect(await service.purgeSession(sessionId, ORG_ID)).toBe(true);
    expect(await service.resolveSession(sessionId, ORG_ID)).toBeNull();
    expect(await service.getSessionMessages(sessionId, ORG_ID)).toBeNull();
  });

  test("a model change keeps the conversation", async () => {
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
    stubHarness(service);

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null,
      {
        cognito: { personalized: true },
        model: "provider-1::chat-model",
      }
    );
    const before = await service.resolveSession(sessionId, ORG_ID);
    await before?.send({ message: "hello" });

    expect(
      await service.updateSessionModel(
        sessionId,
        ORG_ID,
        "provider-1::next-chat-model"
      )
    ).toBe(true);

    const after = await service.resolveSession(sessionId, ORG_ID);
    expect(after).not.toBe(before);
    expect(after?.getHistory().length).toBe(2);
    expect(await db.getSession(sessionId)).toBeNull();
    expect((await service.getSessionMessages(sessionId, ORG_ID))?.model).toBe(
      "provider-1::next-chat-model"
    );
  });
});
