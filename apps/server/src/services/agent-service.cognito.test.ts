import { describe, expect, test } from "bun:test";
import { ensureBundledSkillFiles, type GenerateChatInput } from "@nakama/core";
import type { StoredProfileRecord } from "@nakama/db";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import { SkillsService } from "./skills-service";

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

/** Captures the tool list the provider is actually offered. */
function stubHarnessCapturingTools(
  service: AgentService,
  captured: { names: string[] }
): void {
  const answer = {
    assistantMessage: { content: "ok", role: "assistant", toolCalls: [] },
    content: "ok",
    toolCalls: [],
  };
  Object.assign(service, {
    _providerConfigured: true,
    createHarnessForProfile: () => ({
      provider: {
        generateChat(input: GenerateChatInput) {
          captured.names = (input.tools ?? []).map((tool) => tool.name);
          return Promise.resolve(answer);
        },
        name: "openai",
        streamChat(input: GenerateChatInput) {
          captured.names = (input.tools ?? []).map((tool) => tool.name);
          return Promise.resolve(answer);
        },
      },
    }),
  });
}

async function seedProfileWithSkillManage(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>
): Promise<SkillsService> {
  const now = new Date().toISOString();
  await db.upsertProfile(createDefaultProfile());
  // Platform tool groups only attach when the profile owns at least one tool.
  await db.upsertTool({
    createdAt: now,
    description: "Test tool",
    handlerConfig: { modulePath: "test.js" },
    handlerType: "javascript",
    id: "tool_cognito_seed",
    name: "test_tool",
    updatedAt: now,
  });
  await db.assignToolToProfile("profile_default", "tool_cognito_seed");

  const skills = new SkillsService(db);
  await ensureBundledSkillFiles();
  await skills.syncDiscoveredSkills();
  const manage = (await skills.listSkills()).skills.find(
    (skill) => skill.name === "manage-skills"
  );
  await db.assignSkillToProfile("profile_default", manage!.id);
  return skills;
}

describe("cognito sessions never write back", () => {
  setupTestConfigDir("nakama-cognito-writeback-");

  test("drops skill_manage and propose_org_memory but keeps reading org memory", async () => {
    const db = createInMemoryDatabaseAdapter();
    const skills = await seedProfileWithSkillManage(db);
    const service = new AgentService(null, null, db);
    service.setSkillsService(skills);
    const captured = { names: [] as string[] };
    stubHarnessCapturingTools(service, captured);

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      "user_1",
      { cognito: { personalized: true }, orgRole: "admin" }
    );
    const session = await service.resolveSession(sessionId, ORG_ID);
    await session?.send({ message: "what do you remember" });

    expect(captured.names).not.toContain("skill_manage");
    expect(captured.names).not.toContain("propose_org_memory");
    // Personalized cognito still reads memory; it only refuses to write.
    expect(captured.names).toContain("org_memory_search");
  });

  test("an ordinary session keeps both write paths", async () => {
    const db = createInMemoryDatabaseAdapter();
    const skills = await seedProfileWithSkillManage(db);
    const service = new AgentService(null, null, db);
    service.setSkillsService(skills);
    const captured = { names: [] as string[] };
    stubHarnessCapturingTools(service, captured);

    const sessionId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      "user_1",
      { orgRole: "admin" }
    );
    const session = await service.resolveSession(sessionId, ORG_ID);
    await session?.send({ message: "what do you remember" });

    expect(captured.names).toContain("skill_manage");
    expect(captured.names).toContain("propose_org_memory");
  });

  test("no title and no post-turn skill review are scheduled", async () => {
    const { service } = await createService();
    const scheduled: string[] = [];
    Object.assign(service, {
      sessionTitleService: {
        scheduleSessionTitleGeneration: (id: string) =>
          scheduled.push(`title:${id}`),
      },
      skillPostTurnReviewService: {
        schedulePostTurnSkillReview: (id: string) =>
          scheduled.push(`review:${id}`),
      },
    });

    const cognitoId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null,
      { cognito: { personalized: true } }
    );
    service.scheduleSessionTitleGeneration(cognitoId);
    service.schedulePostTurnSkillReview(cognitoId);
    expect(scheduled).toEqual([]);

    const normalId = await service.createSession(
      ORG_ID,
      "web",
      "profile_default",
      null
    );
    service.scheduleSessionTitleGeneration(normalId);
    service.schedulePostTurnSkillReview(normalId);
    expect(scheduled).toEqual([`title:${normalId}`, `review:${normalId}`]);
  });
});
