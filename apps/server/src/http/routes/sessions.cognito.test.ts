import { describe, expect, test } from "bun:test";
import type { CreateSessionRequest, GenerateChatInput } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { createDefaultProfile } from "../../services/agent-service-test-fixtures";
import { WorkerManagerService } from "../../services/worker-manager-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

setupTestConfigDir("nakama-sessions-cognito-test-");

const PASSWORD = "password123";

const ORG_ID = "org_cognito";

async function createScenario() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const agent = new AgentService(null, null, databaseAdapter);

  const answer = {
    assistantMessage: { content: "ok", role: "assistant", toolCalls: [] },
    content: "ok",
    toolCalls: [],
  };

  Object.assign(agent, {
    _providerConfigured: true,
    createHarnessForProfile: () => ({
      provider: {
        generateChat: (_input: GenerateChatInput) => Promise.resolve(answer),
        name: "openai",
        streamChat: (_input: GenerateChatInput) => Promise.resolve(answer),
      },
    }),
  });
  const workerManager = new WorkerManagerService("/tmp/test-project");

  const { app } = createMinimalHonoApp({
    agent,
    databaseAdapter,
    workerManager,
  });

  await seedOrgAdmin(databaseAdapter, {
    email: "owner@example.com",
    orgId: ORG_ID,
    password: PASSWORD,
    profileId: "profile_owner",
    userId: "user_owner",
  });

  const session = await loginUserSession(
    app,
    "owner@example.com",
    PASSWORD,
    ORG_ID
  );

  return { app, databaseAdapter, session, workerManager };
}

async function createSessionOverHttp(
  app: Awaited<ReturnType<typeof createScenario>>["app"],
  session: Awaited<ReturnType<typeof createScenario>>["session"],
  body: CreateSessionRequest
): Promise<string> {
  const response = await app.fetch(
    new Request("http://localhost:4310/v1/sessions", {
      body: JSON.stringify({
        channel: "web",
        profileId: "profile_owner",
        ...body,
      }),
      headers: session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      }),
      method: "POST",
    })
  );

  expect(response.status).toBe(201);

  // SAFETY: This test controls the fixture shape at this boundary.
  return ((await response.json()) as { sessionId: string }).sessionId;
}

async function sendOverHttp(
  app: Awaited<ReturnType<typeof createScenario>>["app"],
  session: Awaited<ReturnType<typeof createScenario>>["session"],
  sessionId: string
): Promise<Response> {
  return await app.fetch(
    new Request(`http://localhost:4310/v1/sessions/${sessionId}/messages`, {
      body: JSON.stringify({ message: "my card number is 4111" }),
      headers: session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      }),
      method: "POST",
    })
  );
}

describe("POST /v1/sessions with cognito", () => {
  test("accepts WhatsApp sender context only from the WhatsApp worker", async () => {
    const { app, session, workerManager } = await createScenario();

    const sessionId = await createSessionOverHttp(app, session, {
      channel: "whatsapp",
    });

    const whatsappMessage = {
      chatJid: "chat@s.whatsapp.net",
      fromMe: false,
      isGroup: false,
      senderJid: "sender@s.whatsapp.net",
      senderJids: ["sender@s.whatsapp.net"],
    };

    const request = (token?: string) => {
      const headers = session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      });

      if (token) {
        headers["X-Nakama-WhatsApp-Context-Token"] = token;
      }

      return app.fetch(
        new Request(`http://localhost:4310/v1/sessions/${sessionId}/messages`, {
          body: JSON.stringify({
            message: "hello",
            stream: true,
            whatsappMessage,
          }),
          headers,
          method: "POST",
        })
      );
    };

    expect((await request("forged-token")).status).toBe(403);
    expect(
      (await request(await workerManager.getWhatsAppContextToken())).status
    ).toBe(200);
  });

  test("a full turn leaves nothing in the database", async () => {
    const { app, databaseAdapter, session } = await createScenario();

    const sessionId = await createSessionOverHttp(app, session, {
      cognito: true,
    });

    expect((await sendOverHttp(app, session, sessionId)).status).toBe(200);

    // Readable over HTTP for the rest of the session,
    const read = await app.fetch(
      new Request(`http://localhost:4310/v1/sessions/${sessionId}/messages`, {
        headers: session.headers(),
      })
    );

    // SAFETY: This test controls the fixture shape at this boundary.
    const { messages } = (await read.json()) as {
      messages: Array<{ role: string }>;
    };

    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);

    // but written nowhere.
    expect(await databaseAdapter.getSession(sessionId)).toBeNull();
    expect(await databaseAdapter.listMessagesForSession(sessionId)).toEqual([]);
    expect(await databaseAdapter.listSessions()).toEqual([]);
  });

  test("the session is absent from GET /v1/sessions", async () => {
    const { app, session } = await createScenario();

    const cognitoId = await createSessionOverHttp(app, session, {
      cognito: true,
    });

    const normalId = await createSessionOverHttp(app, session, {});
    await sendOverHttp(app, session, cognitoId);
    await sendOverHttp(app, session, normalId);

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/sessions?profileId=profile_owner&channel=web",
        { headers: session.headers() }
      )
    );

    expect(response.status).toBe(200);

    // SAFETY: This test controls the fixture shape at this boundary.
    const { sessions } = (await response.json()) as {
      sessions: Array<{ id: string }>;
    };

    const ids = sessions.map((entry) => entry.id);

    expect(ids).toContain(normalId);
    expect(ids).not.toContain(cognitoId);
  });

  test("deleting it returns 204 and the id stops resolving", async () => {
    const { app, databaseAdapter, session } = await createScenario();

    const sessionId = await createSessionOverHttp(app, session, {
      cognito: true,
    });

    await sendOverHttp(app, session, sessionId);

    // There was never a row, so the delete has only the map to work with.
    expect(await databaseAdapter.getSession(sessionId)).toBeNull();

    const deleted = await app.fetch(
      new Request(`http://localhost:4310/v1/sessions/${sessionId}?purge=true`, {
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "DELETE",
      })
    );

    expect(deleted.status).toBe(204);

    const after = await app.fetch(
      new Request(`http://localhost:4310/v1/sessions/${sessionId}/messages`, {
        headers: session.headers(),
      })
    );

    expect(after.status).toBe(404);
  });

  test("an invalid cognito body is rejected", async () => {
    const { app, session } = await createScenario();

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/sessions", {
        body: JSON.stringify({
          channel: "web",
          cognito: "yes",
          profileId: "profile_owner",
        }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
  });

  test("an explicitly missing profile cannot fall back to the default bot", async () => {
    const { app, databaseAdapter, session } = await createScenario();
    await databaseAdapter.upsertProfile({
      ...createDefaultProfile(),
      orgId: ORG_ID,
    });

    for (const profileId of ["missing-profile", "   "]) {
      const response = await app.fetch(
        new Request("http://localhost:4310/v1/sessions", {
          body: JSON.stringify({ channel: "web", cognito: true, profileId }),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method: "POST",
        })
      );

      expect(response.status).toBe(404);
    }

    expect(await databaseAdapter.listSessions()).toEqual([]);

    // Omitting the profile still selects the organization's default bot.
    const defaultId = await createSessionOverHttp(app, session, {
      cognito: true,
      profileId: undefined,
    });

    expect(defaultId).toBeTruthy();
  });
});
