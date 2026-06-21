import { describe, expect, test } from "bun:test";
import { createHonoApp } from "./app";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import {
  createPlatformAdminUser,
  withOrgId,
} from "./test-org-helpers";

function extractSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);
}

function cookieHeaderFromSetCookies(setCookies: string[]): string {
  const session = setCookies.find((entry) => entry.startsWith("tinyclaw_session="));
  const csrf = setCookies.find((entry) => entry.startsWith("tinyclaw_csrf="));
  return [session, csrf].filter(Boolean).map((entry) => entry!.split(";")[0]).join("; ");
}

function cookieValue(setCookies: string[], name: string): string {
  const cookie = setCookies.find((entry) => entry.startsWith(`${name}=`));
  if (!cookie) {
    throw new Error(`Missing cookie: ${name}`);
  }

  return cookie.split(";")[0]!.split("=", 2)[1]!;
}

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

async function loginPlatformAdmin(
  app: ReturnType<typeof createHonoApp>,
  authService: AuthService,
  databaseAdapter: ReturnType<typeof createInMemoryDatabaseAdapter>,
) {
  await createPlatformAdminUser(databaseAdapter, authService);
  const loginResponse = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "platform@example.com", password: "password123" }),
    }),
  );

  expect(loginResponse.status).toBe(200);
  const setCookies = extractSetCookies(loginResponse);
  return {
    setCookies,
    headers(extra: Record<string, string> = {}) {
      return { Cookie: cookieHeaderFromSetCookies(setCookies), ...extra };
    },
  };
}

describe("platform org routes", () => {
  test("platform admin can create and list organizations", async () => {
    const { app, authService, databaseAdapter } = createPlatformApp();
    const session = await loginPlatformAdmin(app, authService, databaseAdapter);

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers: session.headers({
          "X-CSRF-Token": cookieValue(session.setCookies, "tinyclaw_csrf"),
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
    const platformSession = await loginPlatformAdmin(app, authService, databaseAdapter);

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers: platformSession.headers({
          "X-CSRF-Token": cookieValue(platformSession.setCookies, "tinyclaw_csrf"),
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
    const orgAdminCookies = extractSetCookies(orgAdminLogin);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers: withOrgId(
          {
            Cookie: cookieHeaderFromSetCookies(orgAdminCookies),
            "X-CSRF-Token": cookieValue(orgAdminCookies, "tinyclaw_csrf"),
          },
          created.organization.id,
        ),
        body: JSON.stringify({ name: "Beta Corp", slug: "beta-corp" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  test("returns 409 for duplicate organization slugs", async () => {
    const { app, authService, databaseAdapter } = createPlatformApp();
    const session = await loginPlatformAdmin(app, authService, databaseAdapter);
    const headers = session.headers({
      "X-CSRF-Token": cookieValue(session.setCookies, "tinyclaw_csrf"),
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
