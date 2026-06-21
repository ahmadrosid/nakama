import { describe, expect, test } from "bun:test";
import { createHonoApp } from "./app";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { createPlatformAdminUser } from "./test-org-helpers";

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

function createApp() {
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

describe("direct org member provisioning", () => {
  test("platform admin cannot access org data before the provisioned admin signs in", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const platformSession = await loginPlatformAdmin(app, authService, databaseAdapter);

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers: platformSession.headers({
          "X-CSRF-Token": cookieValue(platformSession.setCookies, "tinyclaw_csrf"),
        }),
        body: JSON.stringify({
          name: "Acme",
          slug: "acme",
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

    const denied = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: platformSession.headers({ "X-Org-Id": created.organization.id }),
      }),
    );

    expect(denied.status).toBe(404);

    const loginResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "admin@acme.com",
          password: created.adminMember.temporaryPassword,
        }),
      }),
    );

    expect(loginResponse.status).toBe(200);
    const orgAdminCookies = extractSetCookies(loginResponse);

    const allowed = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: {
          Cookie: cookieHeaderFromSetCookies(orgAdminCookies),
          "X-Org-Id": created.organization.id,
        },
      }),
    );

    expect(allowed.status).toBe(200);
  });

  test("org admin can add a member and the member can change password", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const platformSession = await loginPlatformAdmin(app, authService, databaseAdapter);

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers: platformSession.headers({
          "X-CSRF-Token": cookieValue(platformSession.setCookies, "tinyclaw_csrf"),
        }),
        body: JSON.stringify({
          name: "Acme",
          slug: "acme",
          admin: {
            name: "Acme Admin",
            email: "admin@acme.com",
            phone: "+628123456789",
          },
        }),
      }),
    );
    const created = (await createResponse.json()) as {
      organization: { id: string };
      adminMember: { temporaryPassword: string };
    };

    const adminLogin = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "admin@acme.com",
          password: created.adminMember.temporaryPassword,
        }),
      }),
    );
    const adminCookies = extractSetCookies(adminLogin);

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${created.organization.id}/members`, {
        method: "POST",
        headers: {
          Cookie: cookieHeaderFromSetCookies(adminCookies),
          "X-Org-Id": created.organization.id,
          "X-CSRF-Token": cookieValue(adminCookies, "tinyclaw_csrf"),
        },
        body: JSON.stringify({
          name: "Member One",
          email: "member@acme.com",
          phone: "+628987654321",
          role: "member",
        }),
      }),
    );

    expect(addMemberResponse.status).toBe(201);
    const added = (await addMemberResponse.json()) as {
      member: { email: string; name: string; phone: string };
      temporaryPassword: string;
    };
    expect(added.member.name).toBe("Member One");
    expect(added.temporaryPassword).toHaveLength(12);

    const memberLogin = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "member@acme.com",
          password: added.temporaryPassword,
        }),
      }),
    );
    const memberCookies = extractSetCookies(memberLogin);

    const changePasswordResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/change-password", {
        method: "POST",
        headers: {
          Cookie: cookieHeaderFromSetCookies(memberCookies),
          "X-CSRF-Token": cookieValue(memberCookies, "tinyclaw_csrf"),
        },
        body: JSON.stringify({
          currentPassword: added.temporaryPassword,
          newPassword: "member-new-password",
        }),
      }),
    );

    expect(changePasswordResponse.status).toBe(200);

    const relogin = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "member@acme.com",
          password: "member-new-password",
        }),
      }),
    );

    expect(relogin.status).toBe(200);
  });
});
