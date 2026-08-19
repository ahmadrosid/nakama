import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { setupTestConfigDir } from "../../test-config-dir";
import type { ServerOptions } from "../context";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

setupTestConfigDir("nakama-sessions-org-scope-test-");

const PASSWORD = "password123";
const ATTACKER_ORG = "org_attacker";
const VICTIM_ORG = "org_victim";

async function createScenario() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const agent = new AgentService(null, null, databaseAdapter);
  const { app } = createMinimalHonoApp({
    agent: agent as unknown as ServerOptions["agent"],
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
      expect(await databaseAdapter.getSession(victimSessionId)).not.toBeNull();
      expect(
        await databaseAdapter.listMessagesForSession(victimSessionId)
      ).toHaveLength(1);
    });
  }

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
});
