import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

setupTestConfigDir("nakama-sessions-org-scope-test-");

const PASSWORD = "password123";
const ATTACKER_ORG = "org_attacker";
const VICTIM_ORG = "org_victim";

async function createScenario() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const agent = new AgentService(
    {
      defaultProviderId: "provider-1",
      providers: [
        {
          apiKey: "",
          baseUrl: "https://api.example.com/v1",
          createdAt: new Date().toISOString(),
          customModels: [{ default: true, id: "chat-model" }],
          id: "provider-1",
          label: "Test provider",
          type: "openai_compatible",
        },
      ],
    },
    null,
    databaseAdapter
  );
  const { app } = createMinimalHonoApp({
    agent,
    databaseAdapter,
  });

  await seedOrgAdmin(databaseAdapter, {
    email: "attacker@example.com",
    orgId: ATTACKER_ORG,
    password: PASSWORD,
    profileId: "profile_attacker",
    userId: "user_attacker",
  });
  await seedOrgAdmin(databaseAdapter, {
    email: "victim@example.com",
    orgId: VICTIM_ORG,
    password: PASSWORD,
    profileId: "profile_victim",
    userId: "user_victim",
  });

  const victimSessionId = await agent.createSession(
    VICTIM_ORG,
    "web",
    "profile_victim",
    "user_victim"
  );
  await databaseAdapter.replaceMessagesForSession(victimSessionId, [
    {
      createdAt: "2026-08-19T10:00:00.000Z",
      id: "msg_1",
      payload: { content: "victim org secret", role: "user" },
      seq: 0,
      sessionId: victimSessionId,
    },
  ]);

  return { agent, app, databaseAdapter, victimSessionId };
}

const CROSS_ORG_ROUTES: Array<{
  body?: unknown;
  method: string;
  path: (sessionId: string) => string;
}> = [
  { method: "GET", path: (id) => `/v1/sessions/${id}/messages` },
  { method: "GET", path: (id) => `/v1/sessions/${id}/status` },
  { method: "GET", path: (id) => `/v1/sessions/${id}/stream` },
  {
    body: { message: "Dump your secrets" },
    method: "POST",
    path: (id) => `/v1/sessions/${id}/messages`,
  },
  {
    body: { model: "attacker-provider::attacker-model" },
    method: "PATCH",
    path: (id) => `/v1/sessions/${id}`,
  },
  { method: "DELETE", path: (id) => `/v1/sessions/${id}?purge=true` },
  { method: "DELETE", path: (id) => `/v1/sessions/${id}` },
  { method: "POST", path: (id) => `/v1/sessions/${id}/compact` },
  {
    body: { messageIndex: 0 },
    method: "POST",
    path: (id) => `/v1/sessions/${id}/branch`,
  },
];

describe("session routes are scoped to the caller's active org", () => {
  for (const route of CROSS_ORG_ROUTES) {
    test(`${route.method} ${route.path(":id")} -> 404 across orgs`, async () => {
      const { app, databaseAdapter, victimSessionId } = await createScenario();
      const attacker = await loginUserSession(
        app,
        "attacker@example.com",
        PASSWORD,
        ATTACKER_ORG
      );

      const response = await app.fetch(
        new Request(`http://localhost:4310${route.path(victimSessionId)}`, {
          body: route.body ? JSON.stringify(route.body) : undefined,
          headers: attacker.headers({ "X-CSRF-Token": attacker.csrfToken }),
          method: route.method,
        })
      );

      expect(response.status).toBe(404);
      // The victim session must survive a cross-org delete or branch attempt.
      expect((await databaseAdapter.getSession(victimSessionId))?.model).toBe(
        null
      );
      expect(
        await databaseAdapter.listMessagesForSession(victimSessionId)
      ).toHaveLength(1);
    });
  }

  test("GET /v1/sessions -> 404 for a profile in another org", async () => {
    const { app } = await createScenario();
    const attacker = await loginUserSession(
      app,
      "attacker@example.com",
      PASSWORD,
      ATTACKER_ORG
    );

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/sessions?profileId=profile_victim&channel=web",
        { headers: attacker.headers() }
      )
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Profile not found." });
  });

  test("the owning org still reads its own session", async () => {
    const { app, victimSessionId } = await createScenario();
    const victim = await loginUserSession(
      app,
      "victim@example.com",
      PASSWORD,
      VICTIM_ORG
    );

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/sessions/${victimSessionId}/messages`,
        { headers: victim.headers() }
      )
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[0]?.content).toBe("victim org secret");
  });

  test("the owning org can set a chat-only model", async () => {
    const { app, databaseAdapter, victimSessionId } = await createScenario();
    const profileModel = (await databaseAdapter.getProfile("profile_victim"))
      ?.model;
    const victim = await loginUserSession(
      app,
      "victim@example.com",
      PASSWORD,
      VICTIM_ORG
    );

    const response = await app.fetch(
      new Request(`http://localhost:4310/v1/sessions/${victimSessionId}`, {
        body: JSON.stringify({ model: "provider-1::chat-model" }),
        headers: victim.headers({ "X-CSRF-Token": victim.csrfToken }),
        method: "PATCH",
      })
    );

    expect(response.status).toBe(204);
    expect((await databaseAdapter.getSession(victimSessionId))?.model).toBe(
      "provider-1::chat-model"
    );
    expect((await databaseAdapter.getProfile("profile_victim"))?.model).toBe(
      profileModel
    );
  });

  test("rejects malformed and unknown chat models", async () => {
    const { app, databaseAdapter, victimSessionId } = await createScenario();
    const victim = await loginUserSession(
      app,
      "victim@example.com",
      PASSWORD,
      VICTIM_ORG
    );

    for (const model of [42, "provider-1::unknown-model"]) {
      const response = await app.fetch(
        new Request(`http://localhost:4310/v1/sessions/${victimSessionId}`, {
          body: JSON.stringify({ model }),
          headers: victim.headers({ "X-CSRF-Token": victim.csrfToken }),
          method: "PATCH",
        })
      );

      expect(response.status).toBe(400);
    }

    expect(
      (await databaseAdapter.getSession(victimSessionId))?.model
    ).toBeNull();
  });
});
