import { describe, expect, test } from "bun:test";
import { setupTestConfigDir } from "../test-config-dir";
import { createMinimalHonoApp } from "./test-app-helpers";
import {
  browserSessionFromResponse,
  loginPlatformAdminSession,
  setupFreshInstallSession,
} from "./test-session-helpers";

setupTestConfigDir("nakama-org-invites-test-");

describe("direct org member provisioning", () => {
  test("domain settings reach admins and restrict invites without changing direct add", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;

    const update = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}`, {
        body: JSON.stringify({ allowedInviteDomains: ["Acme.COM"] }),
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "PATCH",
      })
    );
    expect(update.status).toBe(200);
    expect(
      (
        (await update.json()) as {
          organization: { allowedInviteDomains: string[] };
        }
      ).organization.allowedInviteDomains
    ).toEqual(["acme.com"]);

    const list = await app.fetch(
      new Request("http://localhost:4310/v1/auth/orgs", {
        headers: session.headers(),
      })
    );
    expect(list.status).toBe(200);
    expect(
      (
        (await list.json()) as {
          orgs: Array<{ allowedInviteDomains: string[] }>;
        }
      ).orgs[0]?.allowedInviteDomains
    ).toEqual(["acme.com"]);

    const invite = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/invites`, {
        body: JSON.stringify({ email: "guest@other.com", role: "member" }),
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "POST",
      })
    );
    expect(invite.status).toBe(400);

    const directAdd = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "guest@other.com",
          name: "Guest",
          role: "member",
        }),
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "POST",
      })
    );
    expect(directAdd.status).toBe(201);
  });

  test("platform admin can manage an org without becoming a member", async () => {
    const { app, authService, databaseAdapter } = createMinimalHonoApp();
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

    const platformUser = await databaseAdapter.getUserByEmail(
      "platform@example.com"
    );
    expect(platformUser).toBeDefined();
    expect(
      await databaseAdapter.getOrgMember(
        created.organization.id,
        platformUser!.id
      )
    ).toBeNull();

    const platformAccess = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: platformSession.headers({
          "X-Org-Id": created.organization.id,
        }),
      })
    );

    expect(platformAccess.status).toBe(200);

    const memberOnlyAccess = await app.fetch(
      new Request("http://localhost:4310/v1/sessions", {
        body: JSON.stringify({
          channel: "web",
          profileId: "default",
        }),
        headers: platformSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": platformSession.csrfToken,
          "X-Org-Id": created.organization.id,
        }),
        method: "POST",
      })
    );

    expect(memberOnlyAccess.status).toBe(403);

    const loginResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "admin@acme.com",
          password: created.adminMember.temporaryPassword,
        }),
        headers: { "Content-Type": "application/json" },
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
    const { app, authService, databaseAdapter } = createMinimalHonoApp();
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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
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

    const staleMe = await app.fetch(
      new Request("http://localhost:4310/v1/auth/me", {
        headers: memberSession.headers(),
      })
    );
    expect(staleMe.status).toBe(401);

    const relogin = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "member@acme.com",
          password: "member-new-password",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(relogin.status).toBe(200);
  });

  test("requests and completes a single-use password reset", async () => {
    const { app, authService, orgService } = createMinimalHonoApp();
    await orgService.bootstrapInitialSetup({
      admin: {
        email: "admin@acme.com",
        name: "Acme Admin",
        passwordHash: await authService.hashPassword("password123"),
        phone: "",
      },
      organization: { name: "Acme", slug: "acme-password-reset" },
    });

    const loginResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "admin@acme.com",
          password: "password123",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    const session = browserSessionFromResponse(loginResponse);

    const publicRequestResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/password-reset/request", {
        body: JSON.stringify({ email: "admin@acme.com" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(publicRequestResponse.status).toBe(200);
    expect(await publicRequestResponse.json()).toEqual({
      delivered: true,
      token: null,
    });

    const missingCsrfResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/password-reset/request", {
        body: JSON.stringify({ email: "admin@acme.com" }),
        headers: session.headers(),
        method: "POST",
      })
    );
    expect(missingCsrfResponse.status).toBe(403);

    const requestResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/password-reset/request", {
        body: JSON.stringify({ email: "admin@acme.com" }),
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "POST",
      })
    );
    expect(requestResponse.status).toBe(200);
    const requested = (await requestResponse.json()) as {
      delivered: boolean;
      token: string | null;
    };
    expect(requested.delivered).toBe(false);
    expect(requested.token).toStartWith("tc_reset_");

    const completeResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/password-reset/complete", {
        body: JSON.stringify({
          newPassword: "new-password-123",
          token: requested.token,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(completeResponse.status).toBe(200);

    const staleMe = await app.fetch(
      new Request("http://localhost:4310/v1/auth/me", {
        headers: session.headers(),
      })
    );
    expect(staleMe.status).toBe(401);

    const reuseResponse = await app.fetch(
      new Request("http://localhost:4310/v1/auth/password-reset/complete", {
        body: JSON.stringify({
          newPassword: "another-password-123",
          token: requested.token,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(reuseResponse.status).toBe(400);

    const relogin = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "admin@acme.com",
          password: "new-password-123",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(relogin.status).toBe(200);
  });
});
