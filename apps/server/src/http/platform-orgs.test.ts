import { describe, expect, test } from "bun:test";
import { createHonoApp } from "./app";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { withOrgId } from "./test-org-helpers";
import { browserSessionFromResponse, loginPlatformAdminSession } from "./test-session-helpers";
import { setupTestConfigDir } from "../test-config-dir";

setupTestConfigDir("nakama-platform-orgs-test-");

function createPlatformApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  return {
    databaseAdapter,
    authService,
    app: createHonoApp({
      agent: {
        listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      } as any,
      automationService: {} as any,
      taskService: {} as any,
      systemStatus: { getStatus: async () => ({ ok: true }) } as any,
      workerManager: {} as any,
      mcpService: {} as any,
      authService,
      orgService: new OrgService(databaseAdapter, authService),
      databaseAdapter,
      webDistDir: null,
    }),
  };
}

describe("platform org routes", () => {
  test("platform admin can create and list organizations", async () => {
    const { app, authService, databaseAdapter } = createPlatformApp();
    const session = await loginPlatformAdminSession(app, authService, databaseAdapter);

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
        }),
        body: JSON.stringify({ name: "Acme Corp", slug: "acme-corp" }),
      }),
    );

    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toEqual({
      organization: {
        id: expect.stringMatching(/^org_/),
        name: "Acme Corp",
        slug: "acme-corp",
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
      adminMember: {
        member: {
          createdAt: expect.any(String),
          email: "platform@example.com",
          name: null,
          phone: null,
          role: "admin",
          userId: expect.stringMatching(/^user_/),
        },
        temporaryPassword: null,
      },
    });

    const listResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        headers: session.headers(),
      }),
    );

    expect(listResponse.status).toBe(200);
    const payload = (await listResponse.json()) as { organizations: Array<{ slug: string }> };
    expect(payload.organizations).toHaveLength(1);
    expect(payload.organizations[0]?.slug).toBe("acme-corp");
  });

  test("non-platform users cannot manage organizations", async () => {
    const { app, authService, databaseAdapter } = createPlatformApp();
    const platformSession = await loginPlatformAdminSession(app, authService, databaseAdapter);

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers: platformSession.headers({
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        body: JSON.stringify({
          name: "Acme Corp",
          slug: "acme-corp",
          admin: {
            name: "Acme Admin",
            email: "admin@acme.com",
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

    const orgAdminLogin = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "admin@acme.com",
          password: created.adminMember.temporaryPassword,
        }),
      }),
    );
    expect(orgAdminLogin.status).toBe(200);
    const orgAdminSession = browserSessionFromResponse(orgAdminLogin, created.organization.id);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers: orgAdminSession.headers({
          "X-CSRF-Token": orgAdminSession.csrfToken,
        }),
        body: JSON.stringify({ name: "Beta Corp", slug: "beta-corp" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  test("returns 409 for duplicate organization slugs", async () => {
    const { app, authService, databaseAdapter } = createPlatformApp();
    const session = await loginPlatformAdminSession(app, authService, databaseAdapter);
    const headers = session.headers({
      "X-CSRF-Token": session.csrfToken,
    });

    const first = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Acme", slug: "acme" }),
      }),
    );
    expect(first.status).toBe(201);

    const second = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Acme 2", slug: "acme" }),
      }),
    );

    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({
      error: "Organization slug already exists.",
    });
  });
});
