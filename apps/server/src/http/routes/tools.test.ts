import { describe, expect, test } from "bun:test";
import { NakamaApiError } from "@nakama/core";
import {
  loadToolApiKey,
  loadToolSetup,
  saveToolSetup,
} from "../../services/custom-tool-shared";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  createOrgAdminSession,
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

describe("tool playground routes", () => {
  test("setup approval validates org and target, keeps keys private, and is idempotent", async () => {
    let visibleOrg = "";
    const { app, authService, databaseAdapter } = createApp({
      getProfile: async (orgId: string, profileId: string) => {
        if (orgId !== visibleOrg || profileId !== "target") {
          throw new NakamaApiError("Profile not found.", 404);
        }
        return { profile: { id: profileId } };
      },
    });
    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "setup-org",
      "setup-admin@acme.com"
    );
    visibleOrg = orgId;
    const setupId = crypto.randomUUID();
    await saveToolSetup(orgId, {
      id: setupId,
      name: "generic_tool",
      description: "Provider tool",
      plan: "Read provider data",
      requiresApiKey: true,
      sessionId: "session",
      status: "pending",
    });
    const url = `http://localhost:4310/v1/tool-setups/${setupId}`;
    const headers = adminSession.headers(
      {
        "Content-Type": "application/json",
        "X-CSRF-Token": adminSession.csrfToken,
      },
      orgId
    );
    const approve = (body: unknown) =>
      app.fetch(
        new Request(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })
      );
    expect(
      (await approve({ profileId: "foreign", apiKey: "secret" })).status
    ).toBe(404);
    expect(await loadToolApiKey(orgId, setupId)).toBeUndefined();
    expect((await approve({ profileId: "target" })).status).toBe(400);
    expect(
      (await approve({ profileId: "target", apiKey: "bad\nkey" })).status
    ).toBe(400);
    const approved = await approve({
      profileId: "target",
      apiKey: "private-key",
    });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({
      status: "approved",
      profileId: "target",
    });
    expect((await approve({ apiKey: "overwrite" })).status).toBe(200);
    expect(await loadToolApiKey(orgId, setupId)).toBe("private-key");
    expect((await loadToolSetup(orgId, setupId)).profileId).toBe("target");
    const status = await app.fetch(new Request(url, { headers }));
    expect(await status.text()).not.toContain("private-key");
    await expect(loadToolSetup("other-org", setupId)).rejects.toThrow();
    expect((await app.fetch(new Request(url))).status).toBe(401);
  });
  test("credential endpoint saves only for an admin's organization and never returns the key", async () => {
    let visibleOrg = "";
    const { app, authService, databaseAdapter } = createApp({
      listTools: async (orgId: string) => ({
        tools:
          orgId === visibleOrg
            ? [
                {
                  id: "tool_key",
                  name: "key_tool",
                  handlerType: "javascript",
                  handlerConfig: { requiresApiKey: true },
                },
              ]
            : [],
      }),
    });
    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "credential-org",
      "credential-admin@acme.com"
    );
    visibleOrg = orgId;
    const url = "http://localhost:4310/v1/tools/tool_key/credentials";
    const headers = adminSession.headers(
      {
        "Content-Type": "application/json",
        "X-CSRF-Token": adminSession.csrfToken,
      },
      orgId
    );
    const status = await app.fetch(new Request(url, { headers }));
    expect(await status.json()).toEqual({ configured: false });
    const saved = await app.fetch(
      new Request(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({ apiKey: "private-tool-key" }),
      })
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ configured: true });
    expect(await loadToolApiKey(orgId, "tool_key")).toBe("private-tool-key");
    expect(await loadToolApiKey("another_org", "tool_key")).toBeUndefined();
    expect(
      await (await app.fetch(new Request(url, { headers }))).json()
    ).toEqual({ configured: true });
    const invalid = await app.fetch(
      new Request(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({ apiKey: "key\n[evil]" }),
      })
    );
    expect(invalid.status).toBe(400);
    expect(await loadToolApiKey(orgId, "tool_key")).toBe("private-tool-key");
    visibleOrg = "other_org";
    expect(
      (
        await app.fetch(
          new Request(url, {
            method: "PUT",
            headers,
            body: JSON.stringify({ apiKey: "overwrite" }),
          })
        )
      ).status
    ).toBe(404);
    expect((await app.fetch(new Request(url))).status).toBe(401);
  });
  test("GET source is allowed for plugin-owned tools", async () => {
    const { app, authService, databaseAdapter } = createApp({
      getTool: async (toolId: string) => ({
        tool: {
          createdAt: new Date().toISOString(),
          description: "Plugin write",
          handlerConfig: { actionKey: "write" },
          handlerType: "plugin",
          id: toolId,
          name: "notes_write",
          pluginId: "notes",
          pluginKey: "write",
          updatedAt: new Date().toISOString(),
        },
      }),
      getToolSource: async () => ({
        content: "",
        language: "javascript" as const,
        path: "plugins/notes/write",
      }),
    });
    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-plugin-source",
      "admin-plugin-source@acme.com"
    );

    const source = await app.fetch(
      new Request("http://localhost:4310/v1/tools/tool_plugin/source", {
        headers: adminSession.headers({}, orgId),
      })
    );
    expect(source.status).toBe(200);
    await expect(source.json()).resolves.toMatchObject({
      path: "plugins/notes/write",
    });
  });

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
    for (const method of ["GET", "PUT"]) {
      const credentialResponse = await app.fetch(
        new Request("http://localhost:4310/v1/tools/tool_echo/credentials", {
          method,
          headers: memberSession.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": memberSession.csrfToken,
            },
            orgId
          ),
          ...(method === "PUT"
            ? { body: JSON.stringify({ apiKey: "not-allowed" }) }
            : {}),
        })
      );
      expect(credentialResponse.status).toBe(403);
    }
    for (const method of ["GET", "POST"]) {
      const response = await app.fetch(
        new Request(
          `http://localhost:4310/v1/tool-setups/${crypto.randomUUID()}`,
          {
            method,
            headers: memberSession.headers(
              {
                "Content-Type": "application/json",
                "X-CSRF-Token": memberSession.csrfToken,
              },
              orgId
            ),
            ...(method === "POST"
              ? { body: JSON.stringify({ apiKey: "secret" }) }
              : {}),
          }
        )
      );
      expect(response.status).toBe(403);
    }
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
