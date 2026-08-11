import { describe, expect, test } from "bun:test";
import { setupTestConfigDir } from "../test-config-dir";
import { createMinimalHonoApp } from "./test-app-helpers";
import {
  browserSessionFromResponse,
  loginPlatformAdminSession,
} from "./test-session-helpers";

setupTestConfigDir("nakama-org-invites-test-");

function createApp() {
  return createMinimalHonoApp();
}

describe("direct org member provisioning", () => {
  test("platform admin cannot access org data before the provisioned admin signs in", async () => {
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
            email: "admin@acme.com",
            name: "Acme Admin",
            phone: "+628123456789",
          },
          name: "Acme",
          slug: "acme",
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

    const denied = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: platformSession.headers({
          "X-Org-Id": created.organization.id,
        }),
      })
    );

    expect(denied.status).toBe(404);

    const loginResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "admin@acme.com",
          password: created.adminMember.temporaryPassword,
        }),
        method: "POST",
      })
    );

    expect(loginResponse.status).toBe(200);
    const orgAdminSession = browserSessionFromResponse(
      loginResponse,
      created.organization.id
    );

    const allowed = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: orgAdminSession.headers(),
      })
    );

    expect(allowed.status).toBe(200);
  });

  test("org admin can add a member and the member can change password", async () => {
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
            email: "admin@acme.com",
            name: "Acme Admin",
            phone: "+628123456789",
          },
          name: "Acme",
          slug: "acme",
        }),
        headers: platformSession.headers({
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        method: "POST",
      })
    );
    const created = (await createResponse.json()) as {
      organization: { id: string };
      adminMember: { temporaryPassword: string };
    };

    const adminLogin = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "admin@acme.com",
          password: created.adminMember.temporaryPassword,
        }),
        method: "POST",
      })
    );
    const adminSession = browserSessionFromResponse(
      adminLogin,
      created.organization.id
    );

    const addMemberResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/orgs/${created.organization.id}/members`,
        {
          body: JSON.stringify({
            email: "member@acme.com",
            name: "Member One",
            phone: "+628987654321",
            role: "member",
          }),
          headers: adminSession.headers({
            "X-CSRF-Token": adminSession.csrfToken,
          }),
          method: "POST",
        }
      )
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
        body: JSON.stringify({
          email: "member@acme.com",
          password: added.temporaryPassword,
        }),
        method: "POST",
      })
    );
    const memberSession = browserSessionFromResponse(memberLogin);

    const changePasswordResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/change-password", {
        body: JSON.stringify({
          currentPassword: added.temporaryPassword,
          newPassword: "member-new-password",
        }),
        headers: memberSession.headers({
          "X-CSRF-Token": memberSession.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(changePasswordResponse.status).toBe(200);

    const relogin = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "member@acme.com",
          password: "member-new-password",
        }),
        method: "POST",
      })
    );

    expect(relogin.status).toBe(200);
  });
});
