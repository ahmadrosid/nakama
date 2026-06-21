import { describe, expect, test } from "bun:test";
import { createHonoApp } from "./app";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import {
  buildSetupAuthBody,
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
    const setupResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify(buildSetupAuthBody()),
      }),
    );
    const setupBody = (await setupResponse.json()) as { activeOrgId: string };
    const setCookies = extractSetCookies(setupResponse);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers: withOrgId(
          {
            Cookie: cookieHeaderFromSetCookies(setCookies),
            "X-CSRF-Token": cookieValue(setCookies, "tinyclaw_csrf"),
          },
          setupBody.activeOrgId,
        ),
        body: JSON.stringify({ name: "Acme Corp", slug: "acme-corp" }),
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
