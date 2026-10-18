import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { setupTestConfigDir } from "../test-config-dir";
import { createHonoApp } from "./app";
import {
  loginUserSession,
  setupFreshInstallSession,
} from "./test-session-helpers";

setupTestConfigDir("nakama-http-app-test-");

function createServerOptions() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();

  // SAFETY: The test checks this response against the endpoint contract asserted below.
  return {
    agent: {
      assertSessionProfileAccess: async () => {},
      beginSessionTurn: async () => true,
      createSession: async () => "session_1",
      getProfile: async () => ({ profile: { id: "default" } }),
      getSessionMessages: async () => ({
        channel: "web",
        contextUsage: null,
        messageMeta: [],
        messages: [],
        model: null,
        questionnaire: null,
        todos: [],
      }),
      getSessionQuestionnaire: async () => null,
      getSessionTodos: async () => [],
      getWhatsAppSettings: async () => ({ enabled: false }),
      listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      listSessions: async (
        _orgId: string,
        profileId: string,
        channel: string
      ) => ({
        sessions: [{ id: `${profileId}-${channel}` }],
      }),
      listSkills: async () => ({ skills: [] }),
      providerConfigured: true,
      resolveSession: async () => ({
        send: async (input: { message: string }) => `reply:${input.message}`,
      }),
    } as any,
    authService,
    automationService: {} as any,
    databaseAdapter,
    mcpService: {} as any,
    orgService: new OrgService(databaseAdapter, authService),
    systemStatus: {
      getStatus: async () => ({ ok: true }),
    } as any,
    webDistDir: null,
    workerManager: {
      isValidWorker: () => true,
      startWorker: async () => {},
      stopWorker: async () => {},
    } as any,
  };
}

describe("createHonoApp", () => {
  test("allows org admins to control their WhatsApp worker", async () => {
    const options = createServerOptions();
    const calls: string[] = [];
    options.workerManager.startWorker = async (
      name: string,
      owner: { orgId: string; profileId: string }
    ) => {
      calls.push(`start:${name}:${owner.orgId}:${owner.profileId}`);
    };

    options.workerManager.stopWorker = async (name: string) => {
      calls.push(`stop:${name}`);
    };

    const app = createHonoApp(options);

    const platformSession = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    const now = new Date().toISOString();

    await options.databaseAdapter.createUser({
      createdAt: now,
      email: "org-admin-worker@example.com",
      id: "user_org_admin_worker",
      passwordHash: await options.authService.hashPassword("password123"),
      updatedAt: now,
    });
    await options.databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: platformSession.orgId!,
      role: "admin",
      userId: "user_org_admin_worker",
    });

    const orgAdminSession = await loginUserSession(
      app,
      "org-admin-worker@example.com",
      "password123",
      platformSession.orgId
    );

    const denied = await app.fetch(
      new Request(
        "http://localhost:4310/v1/workers/whatsapp/start?profileId=default",
        {
          headers: orgAdminSession.headers({
            "X-CSRF-Token": orgAdminSession.csrfToken,
          }),
          method: "POST",
        }
      )
    );

    expect(denied.status).toBe(200);
    expect(calls).toEqual([`start:whatsapp:${platformSession.orgId}:default`]);

    const allowed = await app.fetch(
      new Request(
        "http://localhost:4310/v1/workers/telegram/stop?profileId=default",
        {
          headers: platformSession.headers({
            "X-CSRF-Token": platformSession.csrfToken,
          }),
          method: "POST",
        }
      )
    );

    expect(allowed.status).toBe(200);
    expect(calls).toEqual([
      `start:whatsapp:${platformSession.orgId}:default`,
      "stop:telegram",
    ]);
  });

  test("plugin worker controls and logs require an admin of the owning org", async () => {
    const options = createServerOptions();
    const calls: string[] = [];
    let owner = "";
    Object.assign(options.workerManager, {
      isPluginWorkerForOrg: (name: string, orgId: string) =>
        name === "plugin-owned" && orgId === owner,
      listPluginWorkers: async (orgId: string) => {
        calls.push("list:" + orgId);

        return [];
      },
      startWorker: async (name: string) => {
        calls.push(name);
      },
    });
    const app = createHonoApp(options);
    const admin = await setupFreshInstallSession(app, options.databaseAdapter);
    owner = admin.orgId!;

    for (const suffix of ["start", "logs", "clear-logs"]) {
      const response = await app.fetch(
        new Request(
          "http://localhost:4310/v1/workers/plugin-foreign/" + suffix,
          {
            headers: admin.headers({ "X-CSRF-Token": admin.csrfToken }),
            method: suffix === "logs" ? "GET" : "POST",
          }
        )
      );

      expect(response.status).toBe(404);
    }

    expect(calls).toEqual([]);

    const allowed = await app.fetch(
      new Request("http://localhost:4310/v1/workers/plugin-owned/start", {
        headers: admin.headers({ "X-CSRF-Token": admin.csrfToken }),
        method: "POST",
      })
    );

    expect(allowed.status).toBe(200);

    const listed = await app.fetch(
      new Request("http://localhost:4310/v1/workers/plugins", {
        headers: admin.headers(),
      })
    );

    expect(listed.status).toBe(200);
    expect(calls).toEqual(["plugin-owned", "list:" + owner]);

    const now = new Date().toISOString();
    await options.databaseAdapter.createUser({
      createdAt: now,
      email: "worker-member@example.com",
      id: "worker-member",
      passwordHash: await options.authService.hashPassword("password123"),
      updatedAt: now,
    });
    await options.databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: owner,
      role: "member",
      userId: "worker-member",
    });

    const member = await loginUserSession(
      app,
      "worker-member@example.com",
      "password123",
      owner
    );

    for (const suffix of ["start", "logs", "clear-logs"]) {
      const denied = await app.fetch(
        new Request("http://localhost:4310/v1/workers/plugin-owned/" + suffix, {
          headers: member.headers({ "X-CSRF-Token": member.csrfToken }),
          method: suffix === "logs" ? "GET" : "POST",
        })
      );

      expect(denied.status).toBe(403);
    }
  });

  test("creates and lists sessions through Hono routes", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);

    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/sessions", {
        body: JSON.stringify({ channel: "web", profileId: "default" }),
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toEqual({
      sessionId: "session_1",
    });

    const listResponse = await app.fetch(
      new Request(
        "http://localhost:4310/v1/sessions?profileId=default&channel=web",
        {
          headers: session.headers(),
        }
      )
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      sessions: [{ id: "default-web" }],
    });
  });

  test("GET /v1/sessions rejects missing or invalid channel", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);

    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    const listCalls: Array<{ channel: string; profileId: string }> = [];
    const originalListSessions = options.agent.listSessions;
    options.agent.listSessions = async (
      orgId: string,
      profileId: string,
      channel: string
    ) => {
      listCalls.push({ channel, profileId });

      return originalListSessions(orgId, profileId, channel);
    };

    const missingChannel = await app.fetch(
      new Request("http://localhost:4310/v1/sessions?profileId=default", {
        headers: session.headers(),
      })
    );

    expect(missingChannel.status).toBe(400);
    await expect(missingChannel.json()).resolves.toMatchObject({
      error: expect.any(String),
    });

    const invalidChannel = await app.fetch(
      new Request(
        "http://localhost:4310/v1/sessions?profileId=default&channel=not-a-channel",
        {
          headers: session.headers(),
        }
      )
    );

    expect(invalidChannel.status).toBe(400);
    await expect(invalidChannel.json()).resolves.toMatchObject({
      error: expect.any(String),
    });

    expect(listCalls).toEqual([]);
  });

  test("GET /v1/sessions reads channels, limit and cursor", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);

    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    const listCalls: unknown[][] = [];
    options.agent.listSessions = async (...args: unknown[]) => {
      // Everything after orgId and profileId: channels, auth, page,
      // query.
      listCalls.push(args.slice(2));

      return { nextCursor: null, sessions: [] };
    };

    const list = (query: string) =>
      app.fetch(
        new Request(
          `http://localhost:4310/v1/sessions?profileId=default&${query}`,
          { headers: session.headers() }
        )
      );

    expect(
      (await list("channels=web,telegram&limit=30&cursor=abc")).status
    ).toBe(200);
    expect((await list("channel=web")).status).toBe(200);

    for (const invalid of [
      "channels=web,not-a-channel",
      "channel=web&limit=0",
      "channel=web&limit=101",
      "channel=web&limit=ten",
    ]) {
      expect((await list(invalid)).status).toBe(400);
    }

    expect(listCalls).toEqual([
      [
        ["web", "telegram"],
        expect.anything(),
        { cursor: "abc", limit: 30 },
        undefined,
      ],
      ["web", expect.anything(), undefined, undefined],
    ]);
  });

  test("GET /v1/sessions passes a trimmed q of up to 200 characters", async () => {
    const options = createServerOptions();
    const app = createHonoApp(options);

    const session = await setupFreshInstallSession(
      app,
      options.databaseAdapter
    );

    const queries: unknown[] = [];
    options.agent.listSessions = async (...args: unknown[]) => {
      queries.push(args[5]);

      return { nextCursor: null, sessions: [] };
    };

    const list = (q: string) =>
      app.fetch(
        new Request(
          `http://localhost:4310/v1/sessions?profileId=default&channel=web&q=${encodeURIComponent(q)}`,
          { headers: session.headers() }
        )
      );

    expect((await list("  budget plan ")).status).toBe(200);
    expect((await list("   ")).status).toBe(200);
    expect((await list("x".repeat(200))).status).toBe(200);
    expect((await list("x".repeat(201))).status).toBe(400);

    expect(queries).toEqual(["budget plan", undefined, "x".repeat(200)]);
  });
});
