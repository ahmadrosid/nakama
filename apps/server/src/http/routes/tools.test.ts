import { describe, expect, test } from "bun:test";
import { createHonoApp } from "../app";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { loginPlatformAdminSession, loginUserSession } from "../test-session-helpers";
import { setupTestConfigDir } from "../../test-config-dir";

setupTestConfigDir("tinyclaw-tools-route-test-");

function createApp(agentOverrides: Record<string, unknown> = {}) {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const agent = {
    listTools: async () => ({ tools: [] }),
    getTool: async (toolId: string) => ({
      tool: {
        id: toolId,
        name: "echo",
        description: "Echo tool",
        handlerType: "javascript",
        handlerConfig: { modulePath: "echo.js" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }),
    getToolSource: async () => ({
      path: "echo.js",
      content: "export async function run() {}",
      language: "javascript" as const,
    }),
    runToolPlayground: async () => ({ ok: true, result: { echo: "hello" } }),
    suggestToolPlaygroundParams: async () => ({ parameters: { query: "hello" } }),
    ...agentOverrides,
  };

  return {
    databaseAdapter,
    authService,
    app: createHonoApp({
      agent: agent as never,
      automationService: {} as never,
      taskService: {} as never,
      systemStatus: { getStatus: async () => ({ ok: true }) } as never,
      workerManager: {} as never,
      mcpService: {} as never,
      authService,
      orgService: new OrgService(databaseAdapter, authService),
      databaseAdapter,
      webDistDir: null,
    }),
  };
}

async function createOrgAdminSession(app: ReturnType<typeof createApp>["app"], authService: AuthService, databaseAdapter: ReturnType<typeof createInMemoryDatabaseAdapter>, slug: string, email: string) {
  const platformSession = await loginPlatformAdminSession(app, authService, databaseAdapter);

  const createResponse = await app.fetch(
    new Request("http://localhost:4310/v1/platform/orgs", {
      method: "POST",
      headers: platformSession.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": platformSession.csrfToken,
      }),
      body: JSON.stringify({
        name: "Acme",
        slug,
        admin: {
          name: "Acme Admin",
          email,
          phone: "+628123456789",
        },
      }),
    }),
  );

  expect(createResponse.status).toBe(201);
  const created = (await createResponse.json()) as {
    organization: { id: string };
    adminMember: { temporaryPassword: string };
  };

  return {
    orgId: created.organization.id,
    adminSession: await loginUserSession(
      app,
      email,
      created.adminMember.temporaryPassword,
      created.organization.id,
    ),
  };
}

describe("tool playground routes", () => {
  test("org admin can read tool detail", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-read",
      "admin-read@acme.com",
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_echo", {
        headers: adminSession.headers({}, orgId),
      }),
    );

    expect(response.status).toBe(200);
  });

  test("org member cannot read tool detail", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-member",
      "admin-member@acme.com",
    );

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        method: "POST",
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId,
        ),
        body: JSON.stringify({
          name: "Member One",
          email: "member@acme.com",
          phone: "+628111111111",
          role: "member",
        }),
      }),
    );

    expect(addMemberResponse.status).toBe(201);
    const memberProvisioned = (await addMemberResponse.json()) as { temporaryPassword: string };
    const memberSession = await loginUserSession(
      app,
      "member@acme.com",
      memberProvisioned.temporaryPassword,
      orgId,
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_echo", {
        headers: memberSession.headers({}, orgId),
      }),
    );

    expect(response.status).toBe(403);
  });

  test("org admin can run a javascript tool", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const platformSession = await loginPlatformAdminSession(app, authService, databaseAdapter);

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers: platformSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        body: JSON.stringify({
          name: "Acme",
          slug: "acme-run",
          admin: {
            name: "Acme Admin",
            email: "admin-run@acme.com",
            phone: "+628123456789",
          },
        }),
      }),
    );

    const created = (await createResponse.json()) as {
      organization: { id: string };
      adminMember: { temporaryPassword: string };
    };

    const adminSession = await loginUserSession(
      app,
      "admin-run@acme.com",
      created.adminMember.temporaryPassword,
      created.organization.id,
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_echo/run", {
        method: "POST",
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          created.organization.id,
        ),
        body: JSON.stringify({ parameters: { query: "hello" } }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; result: unknown };
    expect(body.ok).toBe(true);
    expect(body.result).toEqual({ echo: "hello" });
  });

  test("org member cannot run a tool in the playground", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-run-deny",
      "admin-run-deny@acme.com",
    );

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        method: "POST",
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId,
        ),
        body: JSON.stringify({
          name: "Member One",
          email: "member-run@acme.com",
          phone: "+628111111111",
          role: "member",
        }),
      }),
    );

    expect(addMemberResponse.status).toBe(201);
    const memberProvisioned = (await addMemberResponse.json()) as { temporaryPassword: string };
    const memberSession = await loginUserSession(
      app,
      "member-run@acme.com",
      memberProvisioned.temporaryPassword,
      orgId,
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_echo/run", {
        method: "POST",
        headers: memberSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": memberSession.csrfToken,
          },
          orgId,
        ),
        body: JSON.stringify({ parameters: { query: "hello" } }),
      }),
    );

    expect(response.status).toBe(403);
  });

  test("non-javascript tools return 400 on run", async () => {
    const { app, authService, databaseAdapter } = createApp({
      runToolPlayground: async () => {
        throw new Error("Only custom JavaScript tools can be run in the playground.");
      },
    });
    const platformSession = await loginPlatformAdminSession(app, authService, databaseAdapter);

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers: platformSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        body: JSON.stringify({
          name: "Acme",
          slug: "acme-builtin",
          admin: {
            name: "Acme Admin",
            email: "admin-builtin@acme.com",
            phone: "+628123456789",
          },
        }),
      }),
    );

    const created = (await createResponse.json()) as {
      organization: { id: string };
      adminMember: { temporaryPassword: string };
    };

    const adminSession = await loginUserSession(
      app,
      "admin-builtin@acme.com",
      created.adminMember.temporaryPassword,
      created.organization.id,
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_builtin/run", {
        method: "POST",
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          created.organization.id,
        ),
        body: JSON.stringify({ parameters: {} }),
      }),
    );

    expect(response.status).toBe(400);
  });
});
