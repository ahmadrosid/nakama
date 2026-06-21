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

async function loginUser(app: ReturnType<typeof createHonoApp>, email: string, password: string) {
  const loginResponse = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  );

  expect(loginResponse.status).toBe(200);
  const setCookies = extractSetCookies(loginResponse);
  return {
    setCookies,
    headers(orgId: string, extra: Record<string, string> = {}) {
      return {
        Cookie: cookieHeaderFromSetCookies(setCookies),
        "X-Org-Id": orgId,
        ...extra,
      };
    },
  };
}

describe("org member management (AE2)", () => {
  test("viewer can read org data but not list or manage members", async () => {
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
    const orgId = created.organization.id;

    const adminSession = await loginUser(
      app,
      "admin@acme.com",
      created.adminMember.temporaryPassword,
    );

    const addViewerResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        method: "POST",
        headers: adminSession.headers(orgId, {
          "X-CSRF-Token": cookieValue(adminSession.setCookies, "tinyclaw_csrf"),
        }),
        body: JSON.stringify({
          name: "Viewer One",
          email: "viewer@acme.com",
          phone: "+628111111111",
          role: "viewer",
        }),
      }),
    );

    expect(addViewerResponse.status).toBe(201);
    const viewerProvisioned = (await addViewerResponse.json()) as { temporaryPassword: string };
    const viewerSession = await loginUser(
      app,
      "viewer@acme.com",
      viewerProvisioned.temporaryPassword,
    );

    const profilesResponse = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: viewerSession.headers(orgId),
      }),
    );
    expect(profilesResponse.status).toBe(200);

    const listMembersResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        headers: viewerSession.headers(orgId),
      }),
    );
    expect(listMembersResponse.status).toBe(403);

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        method: "POST",
        headers: viewerSession.headers(orgId, {
          "X-CSRF-Token": cookieValue(viewerSession.setCookies, "tinyclaw_csrf"),
        }),
        body: JSON.stringify({
          name: "Blocked",
          email: "blocked@acme.com",
          phone: "+628222222222",
          role: "member",
        }),
      }),
    );
    expect(addMemberResponse.status).toBe(403);
  });

  test("org admin can list, change role, and remove members", async () => {
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
          slug: "acme-mgmt",
          admin: {
            name: "Acme Admin",
            email: "admin-mgmt@acme.com",
            phone: "+628123456789",
          },
        }),
      }),
    );

    const created = (await createResponse.json()) as {
      organization: { id: string };
      adminMember: { temporaryPassword: string };
    };
    const orgId = created.organization.id;
    const adminSession = await loginUser(
      app,
      "admin-mgmt@acme.com",
      created.adminMember.temporaryPassword,
    );

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        method: "POST",
        headers: adminSession.headers(orgId, {
          "X-CSRF-Token": cookieValue(adminSession.setCookies, "tinyclaw_csrf"),
        }),
        body: JSON.stringify({
          name: "Member One",
          email: "member-mgmt@acme.com",
          phone: "+628987654321",
          role: "viewer",
        }),
      }),
    );
    const added = (await addMemberResponse.json()) as { member: { userId: string } };

    const listResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        headers: adminSession.headers(orgId),
      }),
    );
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as { members: Array<{ email: string }> };
    expect(listed.members).toHaveLength(2);

    const patchResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members/${added.member.userId}`, {
        method: "PATCH",
        headers: adminSession.headers(orgId, {
          "X-CSRF-Token": cookieValue(adminSession.setCookies, "tinyclaw_csrf"),
        }),
        body: JSON.stringify({ role: "member" }),
      }),
    );
    expect(patchResponse.status).toBe(200);
    const patched = (await patchResponse.json()) as { member: { role: string } };
    expect(patched.member.role).toBe("member");

    const deleteResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members/${added.member.userId}`, {
        method: "DELETE",
        headers: adminSession.headers(orgId, {
          "X-CSRF-Token": cookieValue(adminSession.setCookies, "tinyclaw_csrf"),
        }),
      }),
    );
    expect(deleteResponse.status).toBe(204);

    const afterDelete = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        headers: adminSession.headers(orgId),
      }),
    );
    const remaining = (await afterDelete.json()) as { members: Array<{ email: string }> };
    expect(remaining.members).toHaveLength(1);
    expect(remaining.members[0]?.email).toBe("admin-mgmt@acme.com");
  });
});
