import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { setupTestConfigDir } from "../test-config-dir";
import { describeAuditEvent } from "./audit-log";
import { createMinimalHonoApp } from "./test-app-helpers";
import {
  type AppFetch,
  loginPlatformAdminSession,
  loginUserSession,
  seedOrgAdmin,
} from "./test-session-helpers";

setupTestConfigDir("nakama-audit-log-test-");

describe("audit event coverage", () => {
  test("classifies security routes", () => {
    for (const [method, path, action] of [
      ["POST", "/v1/auth/login", "auth.login"],
      ["POST", "/v1/auth/logout", "auth.logout"],
      ["POST", "/v1/auth/change-password", "auth.password_change"],
      [
        "POST",
        "/v1/auth/password-reset/request",
        "auth.password_reset_request",
      ],
      [
        "POST",
        "/v1/auth/password-reset/complete",
        "auth.password_reset_complete",
      ],
      ["POST", "/v1/auth/mfa/totp/verify", "auth.mfa_totp_enable"],
      ["POST", "/v1/auth/mfa/disable", "auth.mfa_disable"],
      ["POST", "/v1/auth/mfa/passkey/verify", "auth.passkey_register"],
      ["POST", "/v1/auth/mfa/passkey/disable", "auth.passkey_disable"],
      ["POST", "/v1/auth/mfa/backup-codes", "auth.backup_codes_regenerate"],
      ["POST", "/v1/auth/local-token/rotate", "auth.token_rotate"],
      ["POST", "/v1/auth/active-org", "auth.active_org"],
      ["POST", "/v1/auth/setup/import/restore", "data.import"],
      ["POST", "/v1/orgs/org_1/invites", "invite.create"],
      ["DELETE", "/v1/orgs/org_1/invites/invite_1", "invite.revoke"],
      ["POST", "/v1/auth/accept-invite", "invite.accept"],
      ["PATCH", "/v1/orgs/org_1/members/user_1", "member.role_update"],
      ["PUT", "/v1/settings/email", "settings.update"],
      ["PATCH", "/v1/providers/provider_1", "provider.update"],
      ["DELETE", "/v1/platform/orgs/org_1/permanent", "organization.delete"],
      ["DELETE", "/v1/platform/users/user_1", "user.erase"],
      ["DELETE", "/v1/profiles/profile_1", "profile.delete"],
      ["GET", "/v1/profiles/profile_1/pack/export", "profile.export"],
      ["POST", "/v1/platform/data/import/restore", "data.import"],
      ["POST", "/v1/platform/plugins/releases", "plugin.release_install"],
      ["POST", "/v1/profiles/profile_1/tools", "profile.tools.create"],
      ["DELETE", "/v1/profiles/profile_1/tools/tool_1", "profile.tools.delete"],
      [
        "POST",
        "/v1/profiles/profile_1/mcp-servers",
        "profile.mcp_server.create",
      ],
      [
        "DELETE",
        "/v1/profiles/profile_1/mcp-servers/mcp_1",
        "profile.mcp_server.delete",
      ],
      ["POST", "/v1/profiles/profile_1/skills", "profile.skills.create"],
      [
        "DELETE",
        "/v1/profiles/profile_1/skills/skill_1",
        "profile.skills.delete",
      ],
      [
        "PUT",
        "/v1/profiles/profile_1/soul/files/USER.md",
        "profile.soul_update",
      ],
      ["DELETE", "/v1/sessions/session_1", "session.delete"],
      ["DELETE", "/v1/auth/sessions/session_1", "session.revoke"],
      ["DELETE", "/v1/auth/users/user_1/sessions", "session.revoke_all"],
    ] as const) {
      expect(describeAuditEvent(method, path)?.action).toBe(action);
    }
  });

  test("covers security mutations registered in the real route table", () => {
    const { app } = createMinimalHonoApp();

    const routes = app.routes.map((route) => ({
      method: route.method,
      path: route.path,
    }));

    const expected = [
      [
        "POST",
        "/v1/auth/setup/import/restore",
        "/v1/auth/setup/import/restore",
      ],
      ["POST", "/v1/auth/active-org", "/v1/auth/active-org"],
      [
        "POST",
        "/v1/platform/plugins/releases",
        "/v1/platform/plugins/releases",
      ],
      [
        "DELETE",
        "/v1/platform/orgs/:orgId/permanent",
        "/v1/platform/orgs/org_1/permanent",
      ],
      ["DELETE", "/v1/platform/users/:userId", "/v1/platform/users/user_1"],
      ["POST", "/v1/profiles/:profileId/tools", "/v1/profiles/profile_1/tools"],
      [
        "DELETE",
        "/v1/profiles/:profileId/tools/:toolId",
        "/v1/profiles/profile_1/tools/tool_1",
      ],
      [
        "POST",
        "/v1/profiles/:profileId/mcp-servers",
        "/v1/profiles/profile_1/mcp-servers",
      ],
      [
        "DELETE",
        "/v1/profiles/:profileId/mcp-servers/:serverId",
        "/v1/profiles/profile_1/mcp-servers/server_1",
      ],
      [
        "POST",
        "/v1/profiles/:profileId/skills",
        "/v1/profiles/profile_1/skills",
      ],
      [
        "DELETE",
        "/v1/profiles/:profileId/skills/:skillId",
        "/v1/profiles/profile_1/skills/skill_1",
      ],
      [
        "PUT",
        "/v1/profiles/:profileId/soul/files/:fileKey",
        "/v1/profiles/profile_1/soul/files/USER.md",
      ],
      [
        "POST",
        "/v1/auth/password-reset/request",
        "/v1/auth/password-reset/request",
      ],
      [
        "POST",
        "/v1/auth/password-reset/complete",
        "/v1/auth/password-reset/complete",
      ],
      ["POST", "/v1/auth/mfa/totp/verify", "/v1/auth/mfa/totp/verify"],
      ["POST", "/v1/auth/mfa/disable", "/v1/auth/mfa/disable"],
      ["POST", "/v1/auth/mfa/passkey/verify", "/v1/auth/mfa/passkey/verify"],
      ["POST", "/v1/auth/mfa/passkey/disable", "/v1/auth/mfa/passkey/disable"],
      ["POST", "/v1/auth/mfa/backup-codes", "/v1/auth/mfa/backup-codes"],
      ["DELETE", "/v1/auth/sessions/:sessionId", "/v1/auth/sessions/session_1"],
      ["DELETE", "/v1/sessions/:sessionId", "/v1/sessions/session_1"],
      [
        "DELETE",
        "/v1/auth/users/:userId/sessions",
        "/v1/auth/users/user_1/sessions",
      ],
    ] as const;

    for (const [method, routePath, samplePath] of expected) {
      expect(routes).toContainEqual({ method, path: routePath });
      expect(describeAuditEvent(method, samplePath)).not.toBeNull();
    }
  });
});

describe("audit event API", () => {
  test("records actor, organization, outcome, and request", async () => {
    const { app, authService, databaseAdapter } = createMinimalHonoApp();
    const fetchApp: AppFetch = app;

    const session = await loginPlatformAdminSession(
      fetchApp,
      authService,
      databaseAdapter
    );

    const platformUser = await databaseAdapter.getUserByEmail(
      "platform@example.com"
    );

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({ name: "Audit Org", slug: "audit-org" }),
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "POST",
      })
    );

    expect(createResponse.status).toBe(201);

    // SAFETY: The test checks this response against the endpoint contract asserted below.
    const created = (await createResponse.json()) as {
      organization: { id: string };
    };

    const failedActiveOrg = await app.fetch(
      new Request("http://localhost:4310/v1/auth/active-org", {
        body: JSON.stringify({}),
        headers: {
          ...session.headers({ "X-CSRF-Token": session.csrfToken }),
          "Content-Type": "application/json",
        },
        method: "POST",
      })
    );

    expect(failedActiveOrg.status).toBe(400);
    expect(
      await databaseAdapter.listAuditEvents({ action: "auth.active_org" })
    ).toEqual([
      expect.objectContaining({
        action: "auth.active_org",
        metadata: { outcome: "failure", status: 400 },
      }),
    ]);

    const failedLogin = await app.fetch(
      new Request("http://localhost:4310/v1/auth/login", {
        body: JSON.stringify({
          email: "platform@example.com",
          password: "wrong-password",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(failedLogin.status).toBe(401);

    const listResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/audit-events?orgId=${created.organization.id}`,
        { headers: session.headers() }
      )
    );

    expect(listResponse.status).toBe(200);

    const payload = z
      .object({
        events: z.array(
          z.object({
            action: z.string(),
            actorUserId: z.string().nullable(),
            metadata: z.record(z.string(), z.unknown()),
            orgId: z.string().nullable(),
            requestId: z.string().nullable(),
            resourceId: z.string().nullable(),
          })
        ),
      })
      .parse(await listResponse.json());

    expect(payload.events).toEqual([
      expect.objectContaining({
        action: "organization.create",
        actorUserId: platformUser?.id,
        metadata: { outcome: "success", status: 201 },
        orgId: created.organization.id,
        requestId: expect.any(String),
        resourceId: created.organization.id,
      }),
    ]);

    const loginEvents = await databaseAdapter.listAuditEvents({
      action: "auth.login",
    });

    expect(loginEvents).toHaveLength(2);
    expect(loginEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUserId: platformUser?.id,
          metadata: { outcome: "failure", status: 401 },
        }),
      ])
    );
  });

  test("records permanent organization deletion and user erasure", async () => {
    const { app, authService, databaseAdapter, orgService } =
      createMinimalHonoApp();

    const fetchApp: AppFetch = app;

    const session = await loginPlatformAdminSession(
      fetchApp,
      authService,
      databaseAdapter
    );

    const platformUser = await databaseAdapter.getUserByEmail(
      "platform@example.com"
    );

    await orgService.createOrganization({
      name: "Keep Audit Org",
      slug: "keep-audit-org",
    });

    const created = await orgService.createOrganization({
      name: "Erase Audit Org",
      slug: "erase-audit-org",
    });

    await orgService.archiveOrganization(created.organization.id);

    const now = new Date().toISOString();
    await databaseAdapter.createUser({
      createdAt: now,
      email: "erase-audit-user@example.com",
      id: "user_erase_audit",
      passwordHash: await authService.hashPassword("erase-audit-password"),
      updatedAt: now,
    });

    const headers = session.headers({ "X-CSRF-Token": session.csrfToken });

    const deleteOrgResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/platform/orgs/${created.organization.id}/permanent`,
        { headers, method: "DELETE" }
      )
    );

    const eraseUserResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/users/user_erase_audit", {
        headers,
        method: "DELETE",
      })
    );

    expect(deleteOrgResponse.status).toBe(204);
    expect(eraseUserResponse.status).toBe(204);
    expect(
      await databaseAdapter.listAuditEvents({ action: "organization.delete" })
    ).toEqual([
      expect.objectContaining({
        actorUserId: platformUser?.id,
        metadata: { outcome: "success", status: 204 },
        orgId: created.organization.id,
        resourceId: created.organization.id,
        resourceType: "organization",
      }),
    ]);
    expect(
      await databaseAdapter.listAuditEvents({ action: "user.erase" })
    ).toEqual([
      expect.objectContaining({
        actorUserId: platformUser?.id,
        metadata: { outcome: "success", status: 204 },
        orgId: null,
        resourceId: "user_erase_audit",
        resourceType: "user",
      }),
    ]);
  });

  // Accepting an invite is the one invite event that runs on a public route,
  // without a session to attribute it to, so it is recorded from the response.
  test("records an accepted invite against the organization", async () => {
    const { app, authService, databaseAdapter } = createMinimalHonoApp();
    const fetchApp: AppFetch = app;

    await seedOrgAdmin(databaseAdapter, { authService });

    const admin = await loginUserSession(
      fetchApp,
      "admin@example.com",
      "password123"
    );

    const created = await app.fetch(
      new Request("http://localhost:4310/v1/orgs/org_test/invites", {
        body: JSON.stringify({ email: "invited@example.com", role: "member" }),
        headers: admin.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": admin.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(created.status).toBe(201);

    // SAFETY: The token is only absent when a mailer delivered it, and no
    // mailbox is configured here; the assertion below pins that.
    const { token } = (await created.json()) as { token: string | null };

    expect(token).toBeTruthy();

    const accepted = await app.fetch(
      new Request("http://localhost:4310/v1/auth/accept-invite", {
        body: JSON.stringify({ password: "invited-password", token }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(accepted.status).toBe(200);

    expect(
      await databaseAdapter.listAuditEvents({ action: "invite.accept" })
    ).toEqual([
      expect.objectContaining({
        action: "invite.accept",
        metadata: { outcome: "success", status: 200 },
        orgId: "org_test",
        resourceType: "invite",
      }),
    ]);
  });

  test("records the target of an anonymous password reset request", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp();
    await seedOrgAdmin(databaseAdapter);

    const requested = await app.fetch(
      new Request("http://localhost:4310/v1/auth/password-reset/request", {
        body: JSON.stringify({ email: " Admin@Example.com " }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(requested.status).toBe(200);

    expect(
      await databaseAdapter.listAuditEvents({
        action: "auth.password_reset_request",
      })
    ).toEqual([
      expect.objectContaining({
        actorUserId: null,
        metadata: { outcome: "success", status: 200 },
        resourceId: "user_admin",
        resourceType: "user",
      }),
    ]);
  });

  test("records whose password a platform admin reset", async () => {
    const { app, authService, databaseAdapter } = createMinimalHonoApp();
    const fetchApp: AppFetch = app;
    await seedOrgAdmin(databaseAdapter, { authService });

    const session = await loginPlatformAdminSession(
      fetchApp,
      authService,
      databaseAdapter
    );

    const platformUser = await databaseAdapter.getUserByEmail(
      "platform@example.com"
    );

    const requested = await app.fetch(
      new Request("http://localhost:4310/v1/auth/password-reset/request", {
        body: JSON.stringify({ email: "admin@example.com" }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(requested.status).toBe(200);

    // SAFETY: No mailer is configured, so a platform admin gets the token
    // back in the response body; the assertion below pins that.
    const { token } = (await requested.json()) as { token: string | null };
    expect(token).toBeTruthy();

    const completed = await app.fetch(
      new Request("http://localhost:4310/v1/auth/password-reset/complete", {
        body: JSON.stringify({ newPassword: "new-password-123", token }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(completed.status).toBe(200);

    expect(
      await databaseAdapter.listAuditEvents({
        action: "auth.password_reset_request",
      })
    ).toEqual([
      expect.objectContaining({
        actorUserId: platformUser?.id,
        resourceId: "user_admin",
      }),
    ]);
    expect(
      await databaseAdapter.listAuditEvents({
        action: "auth.password_reset_complete",
      })
    ).toEqual([
      expect.objectContaining({
        actorUserId: null,
        metadata: { outcome: "success", status: 200 },
        resourceId: "user_admin",
        resourceType: "user",
      }),
    ]);
  });

  test("records a session revocation", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp();
    const fetchApp: AppFetch = app;

    const member = await seedOrgAdmin(databaseAdapter);

    const session = await loginUserSession(
      fetchApp,
      member.email,
      member.password,
      member.orgId
    );

    const listed = await app.fetch(
      new Request("http://localhost:4310/v1/auth/sessions", {
        headers: session.headers(),
      })
    );

    expect(listed.status).toBe(200);

    // SAFETY: GET /v1/auth/sessions answers with ListBrowserSessionsResponse.
    const { sessions } = (await listed.json()) as {
      sessions: { id: string; current: boolean }[];
    };

    expect(sessions.length).toBeGreaterThan(0);
    const target = sessions.find((s) => !s.current)?.id ?? sessions[0]!.id;

    const revoked = await app.fetch(
      new Request(`http://localhost:4310/v1/auth/sessions/${target}`, {
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "DELETE",
      })
    );

    expect(revoked.status).toBe(200);

    const events = await databaseAdapter.listAuditEvents({
      action: "session.revoke",
    });

    expect(events).toEqual([
      expect.objectContaining({
        action: "session.revoke",
        metadata: { outcome: "success", status: 200 },
        resourceId: target,
        resourceType: "session",
      }),
    ]);
  });

  test("blocks organization admins from reading the ledger", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp();
    const fetchApp: AppFetch = app;
    const member = await seedOrgAdmin(databaseAdapter);

    const session = await loginUserSession(
      fetchApp,
      member.email,
      member.password,
      member.orgId
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/platform/audit-events", {
        headers: session.headers(),
      })
    );

    expect(response.status).toBe(403);
  });
});
