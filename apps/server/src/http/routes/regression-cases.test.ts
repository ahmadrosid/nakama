import { describe, expect, test } from "bun:test";
import type { DatabaseAdapter } from "@nakama/db";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { AuthService } from "../../services/auth-service";
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

async function seedSession(
  databaseAdapter: DatabaseAdapter,
  input: {
    id: string;
    profileId: string;
    userId: string;
    userMessage: string;
  }
): Promise<void> {
  const now = new Date().toISOString();

  await databaseAdapter.upsertSession({
    agentQuestionnaire: null,
    agentTodos: [],
    channel: "web",
    createdAt: now,
    id: input.id,
    model: null,
    profileId: input.profileId,
    title: "Deploy rollback",
    userId: input.userId,
  });

  await databaseAdapter.appendMessagesForSession(input.id, [
    {
      createdAt: now,
      id: `${input.id}_msg_1`,
      payload: { content: input.userMessage, role: "user" },
      seq: 0,
      sessionId: input.id,
    },
    {
      createdAt: now,
      id: `${input.id}_msg_2`,
      payload: { content: "The deploy failed.", role: "assistant" },
      seq: 1,
      sessionId: input.id,
    },
  ]);
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
      userMessage: "Why did the deploy fail?",
      userId,
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
      userMessage: "Why did the deploy fail?",
      userId: "user_a",
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
      userMessage: "Why did the deploy fail?",
      userId: "user_admin",
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
