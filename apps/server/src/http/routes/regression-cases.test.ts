import { describe, expect, test } from "bun:test";
import { formatAgentQuestionnaireAnswersMessage } from "@nakama/core/agent-questionnaire";
import type { DatabaseAdapter, StoredRegressionCaseRecord } from "@nakama/db";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { AuthService } from "../../services/auth-service";
import { sessionTurnRegistry } from "../../services/session-turn-registry";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginPlatformAdminSession,
  loginUserSession,
  seedOrgAdmin,
} from "../test-session-helpers";

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();

  return createMinimalHonoApp({
    agent: new AgentService(null, null, databaseAdapter),
    authService,
    databaseAdapter,
  });
}

type SeedSessionInput = {
  channel?: string;
  id: string;
  profileId: string;
  userId: string;
  userMessages: Array<
    | string
    | Array<{ data?: string; mediaType?: string; text?: string; type: string }>
  >;
};

async function seedSession(
  databaseAdapter: DatabaseAdapter,
  input: SeedSessionInput
): Promise<void> {
  const now = new Date().toISOString();

  await databaseAdapter.upsertSession({
    agentQuestionnaire: null,
    agentTodos: [],
    channel: input.channel ?? "web",
    createdAt: now,
    id: input.id,
    model: null,
    profileId: input.profileId,
    title: "Deploy rollback",
    userId: input.userId,
  });

  const payloads = input.userMessages.flatMap((content, index) => [
    { content, role: "user" },
    { content: `Reply ${index}`, role: "assistant" },
  ]);

  await databaseAdapter.appendMessagesForSession(
    input.id,
    payloads.map((payload, index) => ({
      createdAt: now,
      id: `${input.id}_msg_${index}`,
      payload,
      seq: index,
      sessionId: input.id,
    }))
  );
}

async function seedAutomation(
  databaseAdapter: DatabaseAdapter,
  input: {
    automationId: string;
    orgId: string;
    profileId: string;
    runId: string;
    status: "running" | "completed";
  }
): Promise<void> {
  const now = new Date().toISOString();

  await databaseAdapter.upsertAutomation({
    createdAt: now,
    definition: {
      description: "Nightly ops",
      prompt: "Summarize yesterday's incidents.",
      steps: [],
      trigger: { type: "manual" },
      version: 1,
    },
    enabled: true,
    id: input.automationId,
    name: "Nightly ops",
    orgId: input.orgId,
    profileId: input.profileId,
    updatedAt: now,
    version: 1,
  });

  await databaseAdapter.insertAutomationRun({
    automationId: input.automationId,
    completedAt: input.status === "running" ? null : now,
    error: input.status === "running" ? null : "Rate limited.",
    id: input.runId,
    output: input.status === "running" ? null : "All clear.",
    startedAt: now,
    status: input.status,
  });
}

function caseRecord(
  overrides: Partial<StoredRegressionCaseRecord> = {}
): StoredRegressionCaseRecord {
  return {
    createdAt: "2026-11-03T09:00:00.000Z",
    createdByUserId: "user_admin",
    expectedResult: "Health check failed.",
    id: "regcase_1",
    input: "Why did the deploy fail?",
    orgId: "org_test",
    privateToUserId: null,
    profileId: "agent_1",
    sourceAutomationId: null,
    sourceId: "session_1",
    sourceType: "session",
    ...overrides,
  };
}

describe("regression case routes", () => {
  test("saves a finished chat session and lists it with the source link", async () => {
    const { app, databaseAdapter } = createApp();

    const { email, password, orgId, profileId, userId } = await seedOrgAdmin(
      databaseAdapter,
      { profileId: "agent_1" }
    );

    await seedSession(databaseAdapter, {
      id: "session_1",
      profileId: profileId!,
      userId,
      userMessages: [
        "First question",
        [
          { data: "base64", mediaType: "audio/wav", type: "audio" },
          { text: "Why did the deploy fail?", type: "text" },
        ],
      ],
    });

    const session = await loginUserSession(app, email, password, orgId);

    const headers = session.headers({
      "Content-Type": "application/json",
      "X-CSRF-Token": session.csrfToken,
    });

    const created = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_1/regression-cases",
        {
          body: JSON.stringify({
            expectedResult: "The deploy failed on the health check.",
            messageIndex: 3,
            sourceId: "session_1",
            sourceType: "session",
          }),
          headers,
          method: "POST",
        }
      )
    );

    expect(created.status).toBe(201);

    const createdBody = await created.json();
    expect(createdBody.case).toMatchObject({
      expectedResult: "The deploy failed on the health check.",
      input: "Why did the deploy fail?",
      profileId: "agent_1",
      source: {
        automationId: null,
        id: "session_1",
        path: "/chat/agent_1/session_1",
        type: "session",
      },
    });

    const listed = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_1/regression-cases",
        { headers }
      )
    );

    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.cases).toHaveLength(1);
    expect(listedBody.cases[0].source.path).toBe("/chat/agent_1/session_1");
    expect(listedBody.nextOffset).toBeNull();

    const fetched = await app.fetch(
      new Request(
        `http://localhost:4310/v1/profiles/agent_1/regression-cases/${createdBody.case.id}`,
        { headers }
      )
    );

    expect(fetched.status).toBe(200);
    expect((await fetched.json()).case.id).toBe(createdBody.case.id);
  });

  test("saves a finished automation run and rejects a running one", async () => {
    const { app, databaseAdapter } = createApp();

    const { email, password, orgId } = await seedOrgAdmin(databaseAdapter, {
      profileId: "agent_1",
    });

    await seedAutomation(databaseAdapter, {
      automationId: "automation_1",
      orgId,
      profileId: "agent_1",
      runId: "run_done",
      status: "completed",
    });

    await seedAutomation(databaseAdapter, {
      automationId: "automation_2",
      orgId,
      profileId: "agent_1",
      runId: "run_live",
      status: "running",
    });

    const session = await loginUserSession(app, email, password, orgId);

    const headers = session.headers({
      "Content-Type": "application/json",
      "X-CSRF-Token": session.csrfToken,
    });

    const created = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_1/regression-cases",
        {
          body: JSON.stringify({
            automationId: "automation_1",
            expectedResult: "Lists the incidents from the last day.",
            sourceId: "run_done",
            sourceType: "automation_run",
          }),
          headers,
          method: "POST",
        }
      )
    );

    expect(created.status).toBe(201);
    expect((await created.json()).case).toMatchObject({
      input: "Summarize yesterday's incidents.",
      source: {
        automationId: "automation_1",
        id: "run_done",
        path: "/automations",
        type: "automation_run",
      },
    });

    const running = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_1/regression-cases",
        {
          body: JSON.stringify({
            automationId: "automation_2",
            expectedResult: "Anything.",
            sourceId: "run_live",
            sourceType: "automation_run",
          }),
          headers,
          method: "POST",
        }
      )
    );

    expect(running.status).toBe(409);
  });

  test("pairs a reply with the question before it, past questionnaire answers", async () => {
    const { app, databaseAdapter } = createApp();

    const { email, password, orgId, userId } = await seedOrgAdmin(
      databaseAdapter,
      { profileId: "agent_1" }
    );

    // [question, reply 0, questionnaire answers, reply 1]
    await seedSession(databaseAdapter, {
      id: "session_1",
      profileId: "agent_1",
      userId,
      userMessages: [
        "Why did the deploy fail?",
        formatAgentQuestionnaireAnswersMessage([
          {
            answer: "Production",
            prompt: "Which environment?",
            questionId: "q1",
          },
        ]),
      ],
    });

    const session = await loginUserSession(app, email, password, orgId);

    const save = (messageIndex: number) =>
      app.fetch(
        new Request(
          "http://localhost:4310/v1/profiles/agent_1/regression-cases",
          {
            body: JSON.stringify({
              expectedResult: "Health check failed.",
              messageIndex,
              sourceId: "session_1",
              sourceType: "session",
            }),
            headers: session.headers({
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            }),
            method: "POST",
          }
        )
      );

    const afterAnswers = await save(3);
    expect(afterAnswers.status).toBe(201);
    expect((await afterAnswers.json()).case.input).toBe(
      "Why did the deploy fail?"
    );

    expect((await save(2)).status).toBe(400);
    expect((await save(9)).status).toBe(400);
  });

  test("a chat with a running turn cannot be saved", async () => {
    const { app, databaseAdapter } = createApp();

    const { email, password, orgId, userId } = await seedOrgAdmin(
      databaseAdapter,
      { profileId: "agent_1" }
    );

    await seedSession(databaseAdapter, {
      id: "session_live",
      profileId: "agent_1",
      userId,
      userMessages: ["Why did the deploy fail?"],
    });

    const session = await loginUserSession(app, email, password, orgId);

    const headers = session.headers({
      "Content-Type": "application/json",
      "X-CSRF-Token": session.csrfToken,
    });

    sessionTurnRegistry.beginTurn("session_live");

    try {
      const response = await app.fetch(
        new Request(
          "http://localhost:4310/v1/profiles/agent_1/regression-cases",
          {
            body: JSON.stringify({
              expectedResult: "Health check failed.",
              messageIndex: 1,
              sourceId: "session_live",
              sourceType: "session",
            }),
            headers,
            method: "POST",
          }
        )
      );

      expect(response.status).toBe(409);
    } finally {
      sessionTurnRegistry.cancelTurn("session_live");
    }
  });

  test("another member cannot read input copied from a private chat", async () => {
    const { app, databaseAdapter } = createApp();
    const admin = await seedOrgAdmin(databaseAdapter, { profileId: "agent_1" });

    const member = await seedOrgAdmin(databaseAdapter, {
      email: "member@example.com",
      orgId: admin.orgId,
      role: "member",
      userId: "user_member",
    });

    await seedSession(databaseAdapter, {
      id: "session_private",
      profileId: "agent_1",
      userId: admin.userId,
      userMessages: ["Why did the deploy fail?"],
    });

    const adminSession = await loginUserSession(
      app,
      admin.email,
      admin.password,
      admin.orgId
    );

    const created = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_1/regression-cases",
        {
          body: JSON.stringify({
            expectedResult: "Health check failed.",
            messageIndex: 1,
            sourceId: "session_private",
            sourceType: "session",
          }),
          headers: adminSession.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          }),
          method: "POST",
        }
      )
    );

    expect(created.status).toBe(201);
    const caseId = (await created.json()).case.id;

    const memberSession = await loginUserSession(
      app,
      member.email,
      member.password,
      member.orgId
    );

    const memberHeaders = memberSession.headers();

    const memberList = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_1/regression-cases",
        { headers: memberHeaders }
      )
    );

    expect(memberList.status).toBe(200);
    expect((await memberList.json()).cases).toEqual([]);

    const memberCase = await app.fetch(
      new Request(
        `http://localhost:4310/v1/profiles/agent_1/regression-cases/${caseId}`,
        { headers: memberHeaders }
      )
    );

    expect(memberCase.status).toBe(404);

    const ownerList = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_1/regression-cases",
        { headers: adminSession.headers() }
      )
    );

    expect((await ownerList.json()).cases).toHaveLength(1);
  });

  test("a case saved from a shared channel chat is visible to the org", async () => {
    const { app, databaseAdapter } = createApp();
    const admin = await seedOrgAdmin(databaseAdapter, { profileId: "agent_1" });

    const member = await seedOrgAdmin(databaseAdapter, {
      email: "member@example.com",
      orgId: admin.orgId,
      role: "member",
      userId: "user_member",
    });

    await seedSession(databaseAdapter, {
      channel: "telegram",
      id: "session_shared",
      profileId: "agent_1",
      userId: admin.userId,
      userMessages: ["Why did the deploy fail?"],
    });

    const adminSession = await loginUserSession(
      app,
      admin.email,
      admin.password,
      admin.orgId
    );

    const created = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_1/regression-cases",
        {
          body: JSON.stringify({
            expectedResult: "Health check failed.",
            messageIndex: 1,
            sourceId: "session_shared",
            sourceType: "session",
          }),
          headers: adminSession.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          }),
          method: "POST",
        }
      )
    );

    expect(created.status).toBe(201);

    const memberSession = await loginUserSession(
      app,
      member.email,
      member.password,
      member.orgId
    );

    const memberList = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_1/regression-cases",
        { headers: memberSession.headers() }
      )
    );

    expect(memberList.status).toBe(200);
    expect((await memberList.json()).cases).toHaveLength(1);
  });

  test("a member cannot read or write cases for a super agent profile", async () => {
    const { app, databaseAdapter } = createApp();
    const admin = await seedOrgAdmin(databaseAdapter, { profileId: "agent_1" });

    const member = await seedOrgAdmin(databaseAdapter, {
      email: "member@example.com",
      orgId: admin.orgId,
      role: "member",
      userId: "user_member",
    });

    const now = new Date().toISOString();

    await databaseAdapter.upsertProfile({
      createdAt: now,
      id: "agent_super",
      isSuper: true,
      model: null,
      name: "Super",
      orgId: admin.orgId,
      systemPrompt: "You are Super.",
      updatedAt: now,
    });

    const memberSession = await loginUserSession(
      app,
      member.email,
      member.password,
      member.orgId
    );

    const memberHeaders = memberSession.headers({
      "Content-Type": "application/json",
      "X-CSRF-Token": memberSession.csrfToken,
    });

    const list = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_super/regression-cases",
        { headers: memberHeaders }
      )
    );

    expect(list.status).toBe(403);

    const save = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_super/regression-cases",
        {
          body: JSON.stringify({
            automationId: "missing",
            expectedResult: "Anything.",
            sourceId: "run_missing",
            sourceType: "automation_run",
          }),
          headers: memberHeaders,
          method: "POST",
        }
      )
    );

    expect(save.status).toBe(403);

    const adminSession = await loginUserSession(
      app,
      admin.email,
      admin.password,
      admin.orgId
    );

    const adminList = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_super/regression-cases",
        { headers: adminSession.headers() }
      )
    );

    expect(adminList.status).toBe(200);
  });

  test("lists cases with limit and offset", async () => {
    const { app, databaseAdapter } = createApp();

    const { email, password, orgId } = await seedOrgAdmin(databaseAdapter, {
      profileId: "agent_1",
    });

    for (const index of [1, 2, 3]) {
      await databaseAdapter.createRegressionCase(
        caseRecord({
          createdAt: `2026-11-0${index}T09:00:00.000Z`,
          id: `regcase_${index}`,
        })
      );
    }

    const session = await loginUserSession(app, email, password, orgId);
    const headers = session.headers();

    const first = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_1/regression-cases?limit=2",
        { headers }
      )
    );

    const firstBody = await first.json();

    expect(first.status).toBe(200);
    expect(firstBody.cases).toHaveLength(2);
    expect(firstBody.nextOffset).toBe(2);

    const second = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_1/regression-cases?limit=2&offset=2",
        { headers }
      )
    );

    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(secondBody.cases).toHaveLength(1);
    expect(secondBody.nextOffset).toBeNull();

    const invalid = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_1/regression-cases?limit=0",
        { headers }
      )
    );

    expect(invalid.status).toBe(400);
  });

  test("another org gets a 404 for the case and its run", async () => {
    const { app, databaseAdapter } = createApp();

    const orgA = await seedOrgAdmin(databaseAdapter, {
      email: "a@example.com",
      orgId: "org_a",
      profileId: "agent_a",
      userId: "user_a",
    });

    const orgB = await seedOrgAdmin(databaseAdapter, {
      email: "b@example.com",
      orgId: "org_b",
      profileId: "agent_b",
      userId: "user_b",
    });

    await seedSession(databaseAdapter, {
      id: "session_a",
      profileId: "agent_a",
      userId: "user_a",
      userMessages: ["Why did the deploy fail?"],
    });

    const sessionA = await loginUserSession(
      app,
      orgA.email,
      orgA.password,
      orgA.orgId
    );

    const created = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_a/regression-cases",
        {
          body: JSON.stringify({
            expectedResult: "Health check failed.",
            messageIndex: 1,
            sourceId: "session_a",
            sourceType: "session",
          }),
          headers: sessionA.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": sessionA.csrfToken,
          }),
          method: "POST",
        }
      )
    );

    expect(created.status).toBe(201);
    const caseId = (await created.json()).case.id;

    const sessionB = await loginUserSession(
      app,
      orgB.email,
      orgB.password,
      orgB.orgId
    );

    const headersB = sessionB.headers({
      "Content-Type": "application/json",
      "X-CSRF-Token": sessionB.csrfToken,
    });

    const foreignList = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_a/regression-cases",
        { headers: headersB }
      )
    );

    expect(foreignList.status).toBe(404);

    const foreignCase = await app.fetch(
      new Request(
        `http://localhost:4310/v1/profiles/agent_b/regression-cases/${caseId}`,
        { headers: headersB }
      )
    );

    expect(foreignCase.status).toBe(404);

    const foreignRun = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_b/regression-cases",
        {
          body: JSON.stringify({
            expectedResult: "Health check failed.",
            messageIndex: 1,
            sourceId: "session_a",
            sourceType: "session",
          }),
          headers: headersB,
          method: "POST",
        }
      )
    );

    expect(foreignRun.status).toBe(404);
  });

  test("a user without an org role cannot create a case", async () => {
    const { app, databaseAdapter, authService } = createApp();

    const { orgId } = await seedOrgAdmin(databaseAdapter, {
      profileId: "agent_1",
    });

    await seedSession(databaseAdapter, {
      id: "session_1",
      profileId: "agent_1",
      userId: "user_admin",
      userMessages: ["Why did the deploy fail?"],
    });

    const session = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/agent_1/regression-cases",
        {
          body: JSON.stringify({
            expectedResult: "Health check failed.",
            messageIndex: 1,
            sourceId: "session_1",
            sourceType: "session",
          }),
          headers: session.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            },
            orgId
          ),
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(403);
    expect(
      await databaseAdapter.listRegressionCasesForProfile(orgId, "agent_1")
    ).toEqual([]);
  });
});
