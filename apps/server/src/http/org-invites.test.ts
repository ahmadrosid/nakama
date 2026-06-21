import { describe, expect, test } from "bun:test";
import { createHonoApp } from "./app";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { browserSessionFromResponse, loginPlatformAdminSession } from "./test-session-helpers";

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

describe("direct org member provisioning", () => {
  test("platform admin cannot access org data before the provisioned admin signs in", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const platformSession = await loginPlatformAdminSession(app, authService, databaseAdapter);

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers: platformSession.headers({
          "X-CSRF-Token": platformSession.csrfToken,
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
    const orgAdminSession = browserSessionFromResponse(loginResponse, created.organization.id);

    const allowed = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: orgAdminSession.headers(),
      }),
    );

    expect(allowed.status).toBe(200);
  });

  test("org admin can add a member and the member can change password", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const platformSession = await loginPlatformAdminSession(app, authService, databaseAdapter);

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        method: "POST",
        headers: platformSession.headers({
          "X-CSRF-Token": platformSession.csrfToken,
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
    const adminSession = browserSessionFromResponse(adminLogin, created.organization.id);

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${created.organization.id}/members`, {
        method: "POST",
        headers: adminSession.headers({
          "X-CSRF-Token": adminSession.csrfToken,
        }),
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
    const memberSession = browserSessionFromResponse(memberLogin);

    const changePasswordResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/change-password", {
        method: "POST",
        headers: memberSession.headers({
          "X-CSRF-Token": memberSession.csrfToken,
        }),
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
