import { describe, expect, spyOn, test } from "bun:test";
import { deleteAttachmentBytes } from "@nakama/core/attachments/store";
import {
  createInMemoryDatabaseAdapter,
  seedOrgSuperBotProfile,
} from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { createAttachmentSaver } from "../../services/attachment-service";
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
  const { app, authService } = createMinimalHonoApp({
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

  return { agent, app, authService, databaseAdapter, victimSessionId };
}

const CROSS_ORG_ROUTES: Array<{
  body?: unknown;
  method: string;
  path: (sessionId: string) => string;
}> = [
  { method: "GET", path: (id) => `/v1/sessions/${id}` },
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
  test("remote images require browser auth and org membership, returning only image bytes", async () => {
    const { app } = await createScenario();
    const user = await loginUserSession(
      app,
      "victim@example.com",
      PASSWORD,
      VICTIM_ORG
    );
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=",
      "base64"
    );
    const url =
      "http://localhost:4310/v1/chat/images/proxy?url=https%3A%2F%2F8.8.8.8%2Fimage.png";
    const upstream = spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(png, {
          headers: {
            "content-type": "image/png",
            "set-cookie": "upstream=secret",
          },
        })
    );
    try {
      expect((await app.fetch(new Request(url))).status).toBe(401);
      expect(
        (
          await app.fetch(
            new Request(url, {
              headers: user.headers({}, ATTACKER_ORG),
            })
          )
        ).status
      ).toBe(404);
      expect(upstream).not.toHaveBeenCalled();
      const response = await app.fetch(
        new Request(url, { headers: { Cookie: user.cookieHeader } })
      );
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
      expect(response.headers.get("Content-Type")).toBe("image/png");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(response.headers.get("Content-Security-Policy")).toContain(
        "img-src 'self' data: blob:"
      );
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally {
      upstream.mockRestore();
    }
  });

  test("image content uses browser auth, stays org-scoped, and handles missing bytes", async () => {
    const { app, databaseAdapter, victimSessionId } = await createScenario();
    const saved = await createAttachmentSaver(databaseAdapter, {
      channel: "web",
      orgId: VICTIM_ORG,
      profileId: "profile_victim",
      sessionId: victimSessionId,
    })({
      bytes: Buffer.from("private-image"),
      kind: "image",
      mediaType: "image/png",
    });
    await seedOrgAdmin(databaseAdapter, {
      email: "viewer@example.com",
      orgId: VICTIM_ORG,
      password: PASSWORD,
      role: "viewer",
      userId: "user_viewer",
    });
    const viewer = await loginUserSession(
      app,
      "viewer@example.com",
      PASSWORD,
      VICTIM_ORG
    );
    const attacker = await loginUserSession(
      app,
      "attacker@example.com",
      PASSWORD,
      ATTACKER_ORG
    );
    const url = `http://localhost:4310/v1/attachments/${saved.attachmentId}/content`;
    const response = await app.fetch(
      new Request(url, { headers: { Cookie: viewer.cookieHeader } })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe("private-image");
    expect((await app.fetch(new Request(url))).status).toBe(401);
    expect(
      (await app.fetch(new Request(url, { headers: attacker.headers() })))
        .status
    ).toBe(404);
    await deleteAttachmentBytes(
      VICTIM_ORG,
      "profile_victim",
      saved.attachmentId
    );
    expect(
      (await app.fetch(new Request(url, { headers: viewer.headers() }))).status
    ).toBe(404);
  });

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

  test("app-user session scope is API-key-only across list, message, branch, and run routes", async () => {
    const { app, authService, databaseAdapter } = await createScenario();
    await seedOrgAdmin(databaseAdapter, {
      email: "same-org-attacker@example.com",
      orgId: VICTIM_ORG,
      password: PASSWORD,
      profileId: "profile_same_org_attacker",
      role: "member",
      userId: "user_same_org_attacker",
    });
    const browser = await loginUserSession(
      app,
      "same-org-attacker@example.com",
      PASSWORD,
      VICTIM_ORG
    );
    const secret = `nk_live_${"1".repeat(64)}`;
    await databaseAdapter.createApiKey({
      createdAt: new Date().toISOString(),
      createdByUserId: "user_victim",
      environment: "live",
      expiresAt: null,
      id: "key_app_user_scope_test",
      keyPrefix: secret.slice(0, 20),
      lastUsedAt: null,
      name: "App user scope test",
      orgId: VICTIM_ORG,
      revokedAt: null,
      secretHash: authService.hashToken(secret),
    });
    const apiKeyHeaders = {
      Authorization: `Bearer ${secret}`,
      "X-Org-Id": VICTIM_ORG,
    };
    const apiRequest = (
      path: string,
      options: { appUserId?: string; body?: unknown; method?: string } = {}
    ) =>
      app.fetch(
        new Request(`http://localhost:4310${path}`, {
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
          headers: {
            ...apiKeyHeaders,
            ...(options.appUserId
              ? { "X-Nakama-App-User-Id": options.appUserId }
              : {}),
          },
          method: options.method,
        })
      );
    const browserRequest = (path: string, options: { body?: unknown } = {}) =>
      app.fetch(
        new Request(`http://localhost:4310${path}`, {
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
          headers: browser.headers({
            "X-CSRF-Token": browser.csrfToken,
            "X-Nakama-App-User-Id": "alice",
          }),
          method: options.body === undefined ? "GET" : "POST",
        })
      );

    const created = await apiRequest("/v1/sessions", {
      appUserId: "alice",
      body: { appUserId: "alice", channel: "web", profileId: "profile_victim" },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const { sessionId } = (await created.json()) as { sessionId: string };
    await databaseAdapter.replaceMessagesForSession(sessionId, [
      {
        createdAt: new Date().toISOString(),
        id: "msg_api_user_scope",
        payload: { content: "app user scope", role: "user" },
        seq: 0,
        sessionId,
      },
    ]);
    const listPath = "/v1/sessions?profileId=profile_victim&channel=web";

    const listed = await apiRequest(listPath, { appUserId: "alice" });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      sessions: [{ id: sessionId }],
    });
    const messages = await apiRequest(`/v1/sessions/${sessionId}/messages`, {
      appUserId: "alice",
    });
    expect(messages.status).toBe(200);

    const wrongAppUserList = await apiRequest(listPath, { appUserId: "bob" });
    expect(wrongAppUserList.status).toBe(200);
    expect(await wrongAppUserList.json()).toEqual({ sessions: [] });
    for (const [path, body] of [
      [`/v1/sessions/${sessionId}/messages`, undefined],
      [`/v1/sessions/${sessionId}/branch`, { messageIndex: 0 }],
      [`/v1/sessions/${sessionId}/messages`, { message: "run" }],
    ] as const) {
      const response = await apiRequest(path, {
        appUserId: "bob",
        body,
        method: body === undefined ? "GET" : "POST",
      });
      expect(response.status).toBe(404);
    }

    expect((await browserRequest(listPath)).status).toBe(400);
    for (const [path, body] of [
      [`/v1/sessions/${sessionId}/messages`, undefined],
      [`/v1/sessions/${sessionId}/branch`, { messageIndex: 0 }],
      [`/v1/sessions/${sessionId}/messages`, { message: "run" }],
    ] as const) {
      expect((await browserRequest(path, { body })).status).toBe(400);
    }
    expect((await databaseAdapter.getSession(sessionId))?.appUserId).toBe(
      "alice"
    );
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

  test("the owning org reads one session's summary", async () => {
    const { app, victimSessionId } = await createScenario();
    const victim = await loginUserSession(
      app,
      "victim@example.com",
      PASSWORD,
      VICTIM_ORG
    );

    const response = await app.fetch(
      new Request(`http://localhost:4310/v1/sessions/${victimSessionId}`, {
        headers: victim.headers(),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      channel: "web",
      id: victimSessionId,
      profileId: "profile_victim",
    });
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
  test("renames, pins, lists, and deletes a chat session", async () => {
    const { app, databaseAdapter, victimSessionId } = await createScenario();
    const victim = await loginUserSession(
      app,
      "victim@example.com",
      PASSWORD,
      VICTIM_ORG
    );
    const headers = victim.headers({ "X-CSRF-Token": victim.csrfToken });

    const updated = await app.fetch(
      new Request(`http://localhost:4310/v1/sessions/${victimSessionId}`, {
        body: JSON.stringify({ pinned: true, title: "Pinned chat" }),
        headers,
        method: "PATCH",
      })
    );
    expect(updated.status).toBe(204);

    const listed = await app.fetch(
      new Request(
        "http://localhost:4310/v1/sessions?profileId=profile_victim&channel=web",
        { headers: victim.headers() }
      )
    );
    expect(listed.status).toBe(200);
    expect((await listed.json()).sessions[0]).toMatchObject({
      id: victimSessionId,
      pinned: true,
      title: "Pinned chat",
    });

    const deleted = await app.fetch(
      new Request(
        `http://localhost:4310/v1/sessions/${victimSessionId}?purge=true`,
        {
          headers,
          method: "DELETE",
        }
      )
    );
    expect(deleted.status).toBe(204);
    expect(await databaseAdapter.getSession(victimSessionId)).toBeNull();
  });
});

describe("Super Bot sessions stay admin-only after they are created", () => {
  async function createSuperBotScenario() {
    const scenario = await createScenario();
    await seedOrgAdmin(scenario.databaseAdapter, {
      email: "member@example.com",
      orgId: VICTIM_ORG,
      password: PASSWORD,
      role: "member",
      userId: "user_member",
    });
    const superProfile = await seedOrgSuperBotProfile(
      scenario.databaseAdapter,
      VICTIM_ORG
    );
    const superSessionId = await scenario.agent.createSession(
      VICTIM_ORG,
      "web",
      superProfile.id,
      "user_victim",
      { orgRole: "admin" }
    );
    await scenario.databaseAdapter.replaceMessagesForSession(superSessionId, [
      {
        createdAt: "2026-09-14T10:00:00.000Z",
        id: "msg_super",
        payload: { content: "admin-only task", role: "user" },
        seq: 0,
        sessionId: superSessionId,
      },
    ]);
    const member = await loginUserSession(
      scenario.app,
      "member@example.com",
      PASSWORD,
      VICTIM_ORG
    );

    return {
      ...scenario,
      member,
      superProfileId: superProfile.id,
      superSessionId,
    };
  }

  test("Super Bot images use the same profile access guard as chat history", async () => {
    const { app, databaseAdapter, member, superProfileId, superSessionId } =
      await createSuperBotScenario();
    const saved = await createAttachmentSaver(databaseAdapter, {
      channel: "web",
      orgId: VICTIM_ORG,
      profileId: superProfileId,
      sessionId: superSessionId,
    })({
      bytes: Buffer.from("admin-image"),
      kind: "image",
      mediaType: "image/png",
    });
    const url = `http://localhost:4310/v1/attachments/${saved.attachmentId}/content`;
    expect(
      (await app.fetch(new Request(url, { headers: member.headers() }))).status
    ).toBe(403);
    const admin = await loginUserSession(
      app,
      "victim@example.com",
      PASSWORD,
      VICTIM_ORG
    );
    const response = await app.fetch(
      new Request(url, { headers: admin.headers() })
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("admin-image");
  });

  for (const route of CROSS_ORG_ROUTES) {
    test(`${route.method} ${route.path(":id")} -> 403 for a member`, async () => {
      const { app, databaseAdapter, member, superSessionId } =
        await createSuperBotScenario();

      const response = await app.fetch(
        new Request(`http://localhost:4310${route.path(superSessionId)}`, {
          body: route.body ? JSON.stringify(route.body) : undefined,
          headers: member.headers({ "X-CSRF-Token": member.csrfToken }),
          method: route.method,
        })
      );

      expect(response.status).toBe(403);
      expect(
        await databaseAdapter.listMessagesForSession(superSessionId)
      ).toHaveLength(1);
    });
  }

  test("a member cannot list Super Bot sessions, an admin still can", async () => {
    const { app, member, superProfileId, superSessionId } =
      await createSuperBotScenario();
    const admin = await loginUserSession(
      app,
      "victim@example.com",
      PASSWORD,
      VICTIM_ORG
    );
    const get = (user: typeof member, path: string) =>
      app.fetch(
        new Request(`http://localhost:4310${path}`, { headers: user.headers() })
      );
    const listPath = `/v1/sessions?profileId=${superProfileId}&channel=web`;

    expect((await get(member, listPath)).status).toBe(403);
    expect((await get(admin, listPath)).status).toBe(200);
    expect(
      (await get(admin, `/v1/sessions/${superSessionId}/messages`)).status
    ).toBe(200);
  });
});
