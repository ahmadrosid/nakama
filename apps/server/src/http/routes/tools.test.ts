import { describe, expect, test } from "bun:test";
import { NakamaApiError } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import type { AuthService } from "../../services/auth-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginPlatformAdminSession,
  loginUserSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-tools-route-test-");

function createApp(agentOverrides: Record<string, unknown> = {}) {
  return createMinimalHonoApp({
    agent: {
      getTool: async (toolId: string) => ({
        tool: {
          createdAt: new Date().toISOString(),
          description: "Echo tool",
          handlerConfig: { modulePath: "echo.js" },
          handlerType: "javascript",
          id: toolId,
          name: "echo",
          updatedAt: new Date().toISOString(),
        },
      }),
      getToolSource: async () => ({
        content: "export async function run() {}",
        language: "javascript" as const,
        path: "echo.js",
      }),
      listTools: async () => ({ tools: [] }),
      runToolPlayground: async () => ({ ok: true, result: { echo: "hello" } }),
      suggestToolPlaygroundParams: async () => ({
        parameters: { query: "hello" },
      }),
      ...agentOverrides,
    },
  });
}

async function createOrgAdminSession(
  app: ReturnType<typeof createApp>["app"],
  authService: AuthService,
  databaseAdapter: DatabaseAdapter,
  slug: string,
  email: string
) {
  const platformSession = await loginPlatformAdminSession(
    app,
    authService,
    databaseAdapter
  );

  const createResponse = await app.fetch(
    new Request("http://localhost:4310/v1/platform/orgs", {
      body: JSON.stringify({
        admin: {
          email,
          name: "Acme Admin",
          phone: "+628123456789",
        },
        name: "Acme",
        slug,
      }),
      headers: platformSession.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": platformSession.csrfToken,
      }),
      method: "POST",
    })
  );

  expect(createResponse.status).toBe(201);
  const created = (await createResponse.json()) as {
    organization: { id: string };
    adminMember: { temporaryPassword: string };
  };

  return {
    adminSession: await loginUserSession(
      app,
      email,
      created.adminMember.temporaryPassword,
      created.organization.id
    ),
    orgId: created.organization.id,
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
      "admin-read@acme.com"
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_echo", {
        headers: adminSession.headers({}, orgId),
      })
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
      "admin-member@acme.com"
    );

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "member@acme.com",
          name: "Member One",
          phone: "+628111111111",
          role: "member",
        }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(addMemberResponse.status).toBe(201);
    const memberProvisioned = (await addMemberResponse.json()) as {
      temporaryPassword: string;
    };
    const memberSession = await loginUserSession(
      app,
      "member@acme.com",
      memberProvisioned.temporaryPassword,
      orgId
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_echo", {
        headers: memberSession.headers({}, orgId),
      })
    );

    expect(response.status).toBe(403);
  });

  test("org admin can run a javascript tool", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const platformSession = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({
          admin: {
            email: "admin-run@acme.com",
            name: "Acme Admin",
            phone: "+628123456789",
          },
          name: "Acme",
          slug: "acme-run",
        }),
        headers: platformSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        method: "POST",
      })
    );

    const created = (await createResponse.json()) as {
      organization: { id: string };
      adminMember: { temporaryPassword: string };
    };

    const adminSession = await loginUserSession(
      app,
      "admin-run@acme.com",
      created.adminMember.temporaryPassword,
      created.organization.id
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_echo/run", {
        body: JSON.stringify({ parameters: { query: "hello" } }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          created.organization.id
        ),
        method: "POST",
      })
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
      "admin-run-deny@acme.com"
    );

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "member-run@acme.com",
          name: "Member One",
          phone: "+628111111111",
          role: "member",
        }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(addMemberResponse.status).toBe(201);
    const memberProvisioned = (await addMemberResponse.json()) as {
      temporaryPassword: string;
    };
    const memberSession = await loginUserSession(
      app,
      "member-run@acme.com",
      memberProvisioned.temporaryPassword,
      orgId
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_echo/run", {
        body: JSON.stringify({ parameters: { query: "hello" } }),
        headers: memberSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": memberSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(403);
  });

  test("non-javascript tools return 400 on run", async () => {
    const { app, authService, databaseAdapter } = createApp({
      runToolPlayground: async () => {
        throw new Error(
          "Only custom JavaScript tools can be run in the playground."
        );
      },
    });
    const platformSession = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({
          admin: {
            email: "admin-builtin@acme.com",
            name: "Acme Admin",
            phone: "+628123456789",
          },
          name: "Acme",
          slug: "acme-builtin",
        }),
        headers: platformSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        method: "POST",
      })
    );

    const created = (await createResponse.json()) as {
      organization: { id: string };
      adminMember: { temporaryPassword: string };
    };

    const adminSession = await loginUserSession(
      app,
      "admin-builtin@acme.com",
      created.adminMember.temporaryPassword,
      created.organization.id
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_builtin/run", {
        body: JSON.stringify({ parameters: {} }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          created.organization.id
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
  });

  test("run does not leak an unexpected error's message", async () => {
    const { app, authService, databaseAdapter } = createApp({
      runToolPlayground: async () => {
        throw new Error(
          "SQLITE_CONSTRAINT: UNIQUE constraint failed at /home/nakama/.config/nakama/nakama.db"
        );
      },
    });
    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-run-leak",
      "admin-run-leak@acme.com"
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_echo/run", {
        body: JSON.stringify({ parameters: {} }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "An unexpected server error occurred.",
    });
  });

  test("run still maps a not-found message to 404 without leaking it", async () => {
    const { app, authService, databaseAdapter } = createApp({
      runToolPlayground: async () => {
        throw new NakamaApiError("Tool not found.", 404);
      },
    });
    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-run-404",
      "admin-run-404@acme.com"
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_missing/run", {
        body: JSON.stringify({ parameters: {} }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Tool not found.",
    });
  });
});
