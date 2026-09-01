import { describe, expect, test } from "bun:test";
import { setupTestConfigDir } from "../test-config-dir";
import { createMinimalHonoApp } from "./test-app-helpers";
import {
  loginPlatformAdminSession,
  loginUserSession,
} from "./test-session-helpers";

setupTestConfigDir("nakama-member-removal-sessions-test-");

describe("removing an org member", () => {
  test("revokes the removed member's browser sessions", async () => {
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
            email: "admin-offboard@acme.com",
            name: "Acme Admin",
            phone: "+628123456789",
          },
          name: "Acme",
          slug: "acme-offboard",
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
    const orgId = created.organization.id;
    const adminSession = await loginUserSession(
      app,
      "admin-offboard@acme.com",
      created.adminMember.temporaryPassword
    );

    const addResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "leaver@acme.com",
          name: "Leaver",
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
    const added = (await addResponse.json()) as {
      member: { userId: string };
      temporaryPassword: string;
    };
    const leaverSession = await loginUserSession(
      app,
      "leaver@acme.com",
      added.temporaryPassword
    );

    // /v1/auth/me is the check that matters: the org middleware already 404s a
    // removed member on org-scoped routes, so only an auth route can tell a
    // revoked cookie from a merely org-less one.
    const beforeRemoval = await app.fetch(
      new Request("http://localhost:4310/v1/auth/me", {
        headers: leaverSession.headers(),
      })
    );
    expect(beforeRemoval.status).toBe(200);

    const removeResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/orgs/${orgId}/members/${added.member.userId}`,
        {
          headers: adminSession.headers(
            { "X-CSRF-Token": adminSession.csrfToken },
            orgId
          ),
          method: "DELETE",
        }
      )
    );
    expect(removeResponse.status).toBe(204);

    const afterRemoval = await app.fetch(
      new Request("http://localhost:4310/v1/auth/me", {
        headers: leaverSession.headers(),
      })
    );
    expect(afterRemoval.status).toBe(401);
  });
});
