import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { setupTestConfigDir } from "../test-config-dir";
import { createHonoApp } from "./app";
import {
  browserSessionFromResponse,
  loginPlatformAdminSession,
} from "./test-session-helpers";

setupTestConfigDir("nakama-platform-orgs-test-");

function createPlatformApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  return {
    app: createHonoApp({
      agent: {
        listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      } as any,
      authService,
      automationService: {} as any,
      databaseAdapter,
      mcpService: {} as any,
      orgService: new OrgService(databaseAdapter, authService),
      systemStatus: { getStatus: async () => ({ ok: true }) } as any,
      webDistDir: null,
      workerManager: {} as any,
    }),
    authService,
    databaseAdapter,
  };
}

describe("platform org routes", () => {
  test("platform admin can create and list organizations", async () => {
    const { app, authService, databaseAdapter } = createPlatformApp();
    const session = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({ name: "Acme Corp", slug: "acme-corp" }),
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toEqual({
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
      organization: {
        archivedAt: null,
        createdAt: expect.any(String),
        id: expect.stringMatching(/^org_/),
        name: "Acme Corp",
        skillsCuratorArchiveAfterDays: 90,
        skillsCuratorConsolidateEnabled: false,
        skillsCuratorEnabled: false,
        skillsCuratorLastRunAt: null,
        skillsCuratorStaleAfterDays: 30,
        skillsPostTurnReview: false,
        skillsWriteApproval: false,
        slug: "acme-corp",
        updatedAt: expect.any(String),
      },
    });

    const listResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        headers: session.headers(),
      })
    );

    expect(listResponse.status).toBe(200);
    const payload = (await listResponse.json()) as {
      organizations: Array<{ slug: string }>;
    };
    expect(payload.organizations).toHaveLength(1);
    expect(payload.organizations[0]?.slug).toBe("acme-corp");
  });

  test("non-platform users cannot manage organizations", async () => {
    const { app, authService, databaseAdapter } = createPlatformApp();
    const platformSession = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({
          admin: {
            email: "admin@acme.com",
            name: "Acme Admin",
            phone: "+628123456789",
          },
          name: "Acme Corp",
          slug: "acme-corp",
        }),
        headers: platformSession.headers({
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

    const orgAdminLogin = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "admin@acme.com",
          password: created.adminMember.temporaryPassword,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(orgAdminLogin.status).toBe(200);
    const orgAdminSession = browserSessionFromResponse(
      orgAdminLogin,
      created.organization.id
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({ name: "Beta Corp", slug: "beta-corp" }),
        headers: orgAdminSession.headers({
          "X-CSRF-Token": orgAdminSession.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  test("returns 409 for duplicate organization slugs", async () => {
    const { app, authService, databaseAdapter } = createPlatformApp();
    const session = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    const headers = session.headers({
      "X-CSRF-Token": session.csrfToken,
    });

    const first = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({ name: "Acme", slug: "acme" }),
        headers,
        method: "POST",
      })
    );
    expect(first.status).toBe(201);

    const second = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({ name: "Acme 2", slug: "acme" }),
        headers,
        method: "POST",
      })
    );

    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({
      error: "Organization slug already exists.",
    });
  });

  test("platform admin can archive an organization", async () => {
    const { app, authService, databaseAdapter } = createPlatformApp();
    const session = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    const headers = session.headers({
      "X-CSRF-Token": session.csrfToken,
    });

    const first = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({ name: "Acme", slug: "acme-del" }),
        headers,
        method: "POST",
      })
    );
    expect(first.status).toBe(201);
    const created = (await first.json()) as { organization: { id: string } };

    const second = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({ name: "Beta", slug: "beta-del" }),
        headers,
        method: "POST",
      })
    );
    expect(second.status).toBe(201);

    const archived = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/orgs/${created.organization.id}`,
        {
          headers,
          method: "DELETE",
        }
      )
    );
    expect(archived.status).toBe(200);
    const payload = (await archived.json()) as {
      organization: { archivedAt: string | null; id: string };
    };
    expect(payload.organization.id).toBe(created.organization.id);
    expect(payload.organization.archivedAt).toBeTruthy();
  });

  test("org admin cannot archive via platform delete", async () => {
    const { app, authService, databaseAdapter } = createPlatformApp();
    const platformSession = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({
          admin: {
            email: "admin@acme.com",
            name: "Acme Admin",
            phone: "+628123456789",
          },
          name: "Acme Corp",
          slug: "acme-forbid-del",
        }),
        headers: platformSession.headers({
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

    const orgAdminLogin = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "admin@acme.com",
          password: created.adminMember.temporaryPassword,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(orgAdminLogin.status).toBe(200);
    const orgAdminSession = browserSessionFromResponse(
      orgAdminLogin,
      created.organization.id
    );

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/orgs/${created.organization.id}`,
        {
          headers: orgAdminSession.headers({
            "X-CSRF-Token": orgAdminSession.csrfToken,
          }),
          method: "DELETE",
        }
      )
    );

    expect(response.status).toBe(403);
  });

  test("refuses to archive the last active organization", async () => {
    const { app, authService, databaseAdapter } = createPlatformApp();
    const session = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    const headers = session.headers({
      "X-CSRF-Token": session.csrfToken,
    });

    const created = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({ name: "Only", slug: "only-del" }),
        headers,
        method: "POST",
      })
    );
    expect(created.status).toBe(201);
    const payload = (await created.json()) as { organization: { id: string } };

    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/orgs/${payload.organization.id}`,
        {
          headers,
          method: "DELETE",
        }
      )
    );
    expect(response.status).toBe(409);
  });

  test("archived org context is not found", async () => {
    const { app, authService, databaseAdapter } = createPlatformApp();
    const session = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    const headers = session.headers({
      "X-CSRF-Token": session.csrfToken,
    });

    const first = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({ name: "Acme", slug: "acme-stale" }),
        headers,
        method: "POST",
      })
    );
    expect(first.status).toBe(201);
    const created = (await first.json()) as { organization: { id: string } };

    const second = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({ name: "Beta", slug: "beta-stale" }),
        headers,
        method: "POST",
      })
    );
    expect(second.status).toBe(201);

    const archived = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/orgs/${created.organization.id}`,
        {
          headers,
          method: "DELETE",
        }
      )
    );
    expect(archived.status).toBe(200);

    const members = await app.fetch(
      new Request(
        `http://localhost:4310/v1/orgs/${created.organization.id}/members`,
        {
          headers: session.headers({
            "X-Org-Id": created.organization.id,
          }),
        }
      )
    );
    expect(members.status).toBe(404);
  });
});
