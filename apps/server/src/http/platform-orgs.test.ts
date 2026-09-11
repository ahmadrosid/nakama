import { describe, expect, test } from "bun:test";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import { setupTestConfigDir } from "../test-config-dir";
import { createMinimalHonoApp } from "./test-app-helpers";
import {
  browserSessionFromResponse,
  loginPlatformAdminSession,
  loginUserSession,
} from "./test-session-helpers";

setupTestConfigDir("nakama-platform-orgs-test-");

function createPlatformApp() {
  return createMinimalHonoApp();
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

  test("platform admin can disable and re-enable a member; org admin cannot", async () => {
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
            email: "admin-disable@acme.com",
            name: "Acme Admin",
            phone: "+628123456789",
          },
          name: "Acme Disable",
          slug: "acme-disable",
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
    const orgId = created.organization.id;

    const adminSession = await loginUserSession(
      app,
      "admin-disable@acme.com",
      created.adminMember.temporaryPassword
    );

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "member-disable@acme.com",
          name: "Member Disable",
          phone: "+628987654321",
          role: "member",
        }),
        headers: adminSession.headers(
          { "X-CSRF-Token": adminSession.csrfToken },
          orgId
        ),
        method: "POST",
      })
    );
    expect(addMemberResponse.status).toBe(201);
    const added = (await addMemberResponse.json()) as {
      member: { userId: string };
      temporaryPassword: string;
    };
    const memberSession = await loginUserSession(
      app,
      "member-disable@acme.com",
      added.temporaryPassword,
      orgId
    );

    // Org admin is not enough, disabling an account is platform-admin only.
    const orgAdminAttempt = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/orgs/${orgId}/members/${added.member.userId}/disable`,
        {
          headers: adminSession.headers({
            "X-CSRF-Token": adminSession.csrfToken,
          }),
          method: "POST",
        }
      )
    );
    expect(orgAdminAttempt.status).toBe(403);

    const disableResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/orgs/${orgId}/members/${added.member.userId}/disable`,
        {
          headers: platformSession.headers({
            "X-CSRF-Token": platformSession.csrfToken,
          }),
          method: "POST",
        }
      )
    );
    expect(disableResponse.status).toBe(204);

    // The disabled member's existing session dies immediately, not just at next login.
    const staleSessionResponse = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: memberSession.headers({}, orgId),
      })
    );
    expect(staleSessionResponse.status).toBe(401);

    const loginAttempt = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "member-disable@acme.com",
          password: added.temporaryPassword,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(loginAttempt.status).toBe(403);
    await expect(loginAttempt.json()).resolves.toEqual({
      error: "Account disabled",
    });

    const enableResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/orgs/${orgId}/members/${added.member.userId}/enable`,
        {
          headers: platformSession.headers({
            "X-CSRF-Token": platformSession.csrfToken,
          }),
          method: "POST",
        }
      )
    );
    expect(enableResponse.status).toBe(204);

    const loginAfterEnable = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "member-disable@acme.com",
          password: added.temporaryPassword,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(loginAfterEnable.status).toBe(200);
  });

  test("disabling the last org admin is blocked", async () => {
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
            email: "sole-admin@acme.com",
            name: "Sole Admin",
            phone: "+628123456789",
          },
          name: "Acme Sole",
          slug: "acme-sole-admin",
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
      adminMember: { member: { userId: string } };
    };
    const orgId = created.organization.id;

    // Every new org also seats the local-client account as admin, so the human
    // admin has to go first before local-client becomes the last remaining one.
    const disableHumanAdmin = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/orgs/${orgId}/members/${created.adminMember.member.userId}/disable`,
        {
          headers: platformSession.headers({
            "X-CSRF-Token": platformSession.csrfToken,
          }),
          method: "POST",
        }
      )
    );
    expect(disableHumanAdmin.status).toBe(204);

    const disableLastAdmin = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/orgs/${orgId}/members/${LOCAL_CLIENT_USER_ID}/disable`,
        {
          headers: platformSession.headers({
            "X-CSRF-Token": platformSession.csrfToken,
          }),
          method: "POST",
        }
      )
    );
    expect(disableLastAdmin.status).toBe(409);
  });

  test("disabling a user via one org is blocked if it would leave another org with no usable admin", async () => {
    const { app, authService, databaseAdapter } = createPlatformApp();
    const platformSession = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );

    const createOrgA = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({
          admin: {
            email: "cross-org-admin@acme.com",
            name: "Cross Org Admin",
            phone: "+628123456789",
          },
          name: "Acme Cross A",
          slug: "acme-cross-a",
        }),
        headers: platformSession.headers({
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        method: "POST",
      })
    );
    expect(createOrgA.status).toBe(201);
    const orgA = (await createOrgA.json()) as {
      organization: { id: string };
      adminMember: { member: { userId: string } };
    };

    const createOrgB = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({
          admin: {
            email: "other-admin@acme.com",
            name: "Other Admin",
            phone: "+628999888777",
          },
          name: "Acme Cross B",
          slug: "acme-cross-b",
        }),
        headers: platformSession.headers({
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        method: "POST",
      })
    );
    expect(createOrgB.status).toBe(201);
    const orgB = (await createOrgB.json()) as { organization: { id: string } };

    // org A's human admin also joins org B as a plain member.
    await databaseAdapter.upsertOrgMember({
      createdAt: new Date().toISOString(),
      orgId: orgB.organization.id,
      role: "member",
      userId: orgA.adminMember.member.userId,
    });

    // Local-client is org A's only other admin, so disabling it first leaves
    // the human as org A's sole usable admin, while staying a plain member of
    // org B.
    const disableLocalClientInOrgA = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/orgs/${orgA.organization.id}/members/${LOCAL_CLIENT_USER_ID}/disable`,
        {
          headers: platformSession.headers({
            "X-CSRF-Token": platformSession.csrfToken,
          }),
          method: "POST",
        }
      )
    );
    expect(disableLocalClientInOrgA.status).toBe(204);

    // Disabling the human through org B, where they are only a member, must
    // still be blocked: disabled_at is install-wide, and org A would be left
    // with no usable admin.
    const disableThroughOrgB = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/orgs/${orgB.organization.id}/members/${orgA.adminMember.member.userId}/disable`,
        {
          headers: platformSession.headers({
            "X-CSRF-Token": platformSession.csrfToken,
          }),
          method: "POST",
        }
      )
    );
    expect(disableThroughOrgB.status).toBe(409);
  });

  test("disabling the install's only platform admin is blocked even when they are just a plain org member", async () => {
    const { app, authService, databaseAdapter } = createPlatformApp();
    const platformSession = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    const platformAdminUser = await databaseAdapter.getUserByEmail(
      "platform@example.com"
    );
    if (!platformAdminUser) {
      throw new Error("platform admin user not found");
    }

    const createOrgResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({
          admin: {
            email: "org-owner@acme.com",
            name: "Org Owner",
            phone: "+628123456789",
          },
          name: "Acme Platform Admin Member",
          slug: "acme-platform-admin-member",
        }),
        headers: platformSession.headers({
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        method: "POST",
      })
    );
    expect(createOrgResponse.status).toBe(201);
    const created = (await createOrgResponse.json()) as {
      organization: { id: string };
    };

    // The platform admin has no admin role anywhere, only a plain membership
    // here, so the org-admin loop above never looks at them.
    await databaseAdapter.upsertOrgMember({
      createdAt: new Date().toISOString(),
      orgId: created.organization.id,
      role: "member",
      userId: platformAdminUser.id,
    });

    const disableResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/orgs/${created.organization.id}/members/${platformAdminUser.id}/disable`,
        {
          headers: platformSession.headers({
            "X-CSRF-Token": platformSession.csrfToken,
          }),
          method: "POST",
        }
      )
    );
    expect(disableResponse.status).toBe(409);
  });
});
