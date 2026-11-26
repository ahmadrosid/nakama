import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { setupTestConfigDir } from "../test-config-dir";
import { createMinimalHonoApp } from "./test-app-helpers";
import {
  type AppFetch,
  loginPlatformAdminSession,
  loginUserSession,
  seedOrgAdmin,
} from "./test-session-helpers";

setupTestConfigDir("nakama-audit-log-test-");

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
      (await databaseAdapter.listAuditEvents({ action: "auth.active_org" }))
        .events
    ).toMatchObject([
      expect.objectContaining({
        action: "auth.active_org",
        outcome: "failure",
        status: 400,
        metadata: {},
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
            outcome: z.enum(["success", "failure"]),
            requestId: z.string().nullable(),
            resourceId: z.string().nullable(),
            status: z.number().nullable(),
          })
        ),
      })
      .parse(await listResponse.json());

    expect(payload.events).toEqual([
      expect.objectContaining({
        action: "organization.create",
        actorUserId: platformUser?.id,
        outcome: "success",
        status: 201,
        metadata: {},
        orgId: created.organization.id,
        requestId: expect.any(String),
        resourceId: created.organization.id,
      }),
    ]);

    const loginEvents = (
      await databaseAdapter.listAuditEvents({
        action: "auth.login",
      })
    ).events;

    expect(loginEvents).toHaveLength(2);
    expect(loginEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorMode: "session",
          actorUserId: platformUser?.id,
          outcome: "success",
        }),
        expect.objectContaining({
          actorMode: "anonymous",
          actorUserId: platformUser?.id,
          outcome: "failure",
          status: 401,
          metadata: {},
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
      (await databaseAdapter.listAuditEvents({ action: "organization.delete" }))
        .events
    ).toMatchObject([
      expect.objectContaining({
        actorUserId: platformUser?.id,
        outcome: "success",
        status: 204,
        metadata: {},
        orgId: created.organization.id,
        resourceId: created.organization.id,
        resourceType: "organization",
      }),
    ]);
    expect(
      (await databaseAdapter.listAuditEvents({ action: "user.erase" })).events
    ).toMatchObject([
      expect.objectContaining({
        actorUserId: platformUser?.id,
        outcome: "success",
        status: 204,
        metadata: {},
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
      (await databaseAdapter.listAuditEvents({ action: "invite.accept" }))
        .events
    ).toMatchObject([
      expect.objectContaining({
        action: "invite.accept",
        outcome: "success",
        status: 200,
        metadata: {},
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
      (
        await databaseAdapter.listAuditEvents({
          action: "auth.password_reset_request",
        })
      ).events
    ).toMatchObject([
      expect.objectContaining({
        actorUserId: null,
        outcome: "success",
        status: 200,
        metadata: {},
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
      (
        await databaseAdapter.listAuditEvents({
          action: "auth.password_reset_request",
        })
      ).events
    ).toMatchObject([
      expect.objectContaining({
        actorUserId: platformUser?.id,
        resourceId: "user_admin",
      }),
    ]);
    expect(
      (
        await databaseAdapter.listAuditEvents({
          action: "auth.password_reset_complete",
        })
      ).events
    ).toMatchObject([
      expect.objectContaining({
        actorUserId: null,
        outcome: "success",
        status: 200,
        metadata: {},
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

    const events = (
      await databaseAdapter.listAuditEvents({
        action: "session.revoke",
      })
    ).events;

    expect(events).toEqual([
      expect.objectContaining({
        action: "session.revoke",
        outcome: "success",
        status: 200,
        metadata: {},
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

  test("records the request context of an audited action", async () => {
    const { app, databaseAdapter, authService } = createMinimalHonoApp();
    const fetchApp: AppFetch = app;

    const session = await loginPlatformAdminSession(
      fetchApp,
      authService,
      databaseAdapter
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/auth/me", {
        body: JSON.stringify({ name: "Audit Context" }),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "TestAgent/1.0",
          "X-Forwarded-For": "203.0.113.5, 10.0.0.1",
          ...session.headers({ "X-CSRF-Token": session.csrfToken }),
        },
        method: "PATCH",
      })
    );

    expect(response.status).toBe(200);

    const events = (
      await databaseAdapter.listAuditEvents({ action: "account.update" })
    ).events;

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "account.update",
      actorMode: "session",
      clientIp: null,
      forwardedFor: "203.0.113.5, 10.0.0.1",
      method: "PATCH",
      outcome: "success",
      route: "/v1/auth/me",
      sessionId: expect.any(String),
      status: 200,
      userAgent: "TestAgent/1.0",
    });
    expect(events[0]!.seq).toBeGreaterThan(0);
    expect(events[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("org admins read their org ledger, not another org's", async () => {
    const { app, databaseAdapter, orgService } = createMinimalHonoApp();
    const fetchApp: AppFetch = app;
    const member = await seedOrgAdmin(databaseAdapter);

    const otherOrg = await orgService.createOrganization({
      name: "Other Org",
      slug: "other-org",
    });

    const session = await loginUserSession(
      fetchApp,
      member.email,
      member.password,
      member.orgId
    );

    const own = await app.fetch(
      new Request(
        `http://localhost:4310/v1/orgs/${member.orgId}/audit-events`,
        { headers: session.headers() }
      )
    );

    expect(own.status).toBe(200);

    const payload = z
      .object({ events: z.array(z.unknown()), total: z.number() })
      .parse(await own.json());

    expect(payload.total).toBeTypeOf("number");
    expect(Array.isArray(payload.events)).toBe(true);

    const stats = await app.fetch(
      new Request(
        `http://localhost:4310/v1/orgs/${member.orgId}/audit-events/stats`,
        { headers: session.headers() }
      )
    );

    expect(stats.status).toBe(200);
    expect(await stats.json()).toEqual({ categories: expect.any(Array) });

    const other = await app.fetch(
      new Request(
        `http://localhost:4310/v1/orgs/${otherOrg.organization.id}/audit-events`,
        { headers: session.headers() }
      )
    );

    expect(other.status).toBe(404);

    const denied = await app.fetch(
      new Request("http://localhost:4310/v1/orgs/org_1/audit-events", {
        headers: session.headers(),
      })
    );

    expect(denied.status).toBe(404);
  });

  test("records a request the org check rejects before the route runs", async () => {
    const { app, authService, databaseAdapter } = createMinimalHonoApp();
    const fetchApp: AppFetch = app;

    const session = await loginPlatformAdminSession(
      fetchApp,
      authService,
      databaseAdapter
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/skills/skill%201", {
        headers: session.headers({
          "X-CSRF-Token": session.csrfToken,
          "X-Org-Id": "org_missing",
        }),
        method: "DELETE",
      })
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(
      (await databaseAdapter.listAuditEvents({ action: "skill.delete" })).events
    ).toMatchObject([
      {
        actorMode: "session",
        outcome: "failure",
        resourceId: "skill 1",
        status: response.status,
      },
    ]);
  });
});

describe("installation-wide audit events", () => {
  test("stay out of the admin's active org ledger", async () => {
    const { app, authService, databaseAdapter } = createMinimalHonoApp();
    const fetchApp: AppFetch = app;

    const session = await loginPlatformAdminSession(
      fetchApp,
      authService,
      databaseAdapter
    );

    const createResponse = await app.fetch(
      new Request("http://localhost:4310/v1/platform/orgs", {
        body: JSON.stringify({ name: "Scope Org", slug: "scope-org" }),
        headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
        method: "POST",
      })
    );

    // SAFETY: The test checks this response against the endpoint contract.
    const created = (await createResponse.json()) as {
      organization: { id: string };
    };

    const activeOrg = await app.fetch(
      new Request("http://localhost:4310/v1/auth/active-org", {
        body: JSON.stringify({ orgId: created.organization.id }),
        headers: {
          ...session.headers({ "X-CSRF-Token": session.csrfToken }),
          "Content-Type": "application/json",
        },
        method: "POST",
      })
    );

    expect(activeOrg.status).toBe(200);

    // Settings routes pass the org check, so the active org is known here.
    // The setting is installation-wide, so the row must not carry that org.
    await app.fetch(
      new Request("http://localhost:4310/v1/settings/timezone", {
        body: JSON.stringify({}),
        headers: {
          ...session.headers({ "X-CSRF-Token": session.csrfToken }),
          "Content-Type": "application/json",
          "X-Org-Id": created.organization.id,
        },
        method: "PUT",
      })
    );

    const events = (
      await databaseAdapter.listAuditEvents({ action: "settings.update" })
    ).events;

    expect(events).toHaveLength(1);
    expect(events[0]?.orgId).toBeNull();
  });
});
