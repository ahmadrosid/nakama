import { describe, expect, test } from "bun:test";
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
  test.each([
    ["POST", "/v1/auth/login", "auth.login"],
    ["POST", "/v1/auth/logout", "auth.logout"],
    ["POST", "/v1/auth/change-password", "auth.password_change"],
    ["POST", "/v1/auth/local-token/rotate", "auth.token_rotate"],
    ["POST", "/v1/orgs/org_1/invites", "invite.create"],
    ["PATCH", "/v1/orgs/org_1/members/user_1", "member.role_update"],
    ["PUT", "/v1/settings/email", "settings.update"],
    ["PATCH", "/v1/providers/provider_1", "provider.update"],
    ["DELETE", "/v1/profiles/profile_1", "profile.delete"],
    ["GET", "/v1/profiles/profile_1/pack/export", "profile.export"],
    ["POST", "/v1/platform/data/import/restore", "data.import"],
    ["DELETE", "/v1/sessions/session_1", "session.revoke"],
  ])("classifies %s %s", (method, path, action) => {
    expect(describeAuditEvent(method, path)?.action).toBe(action);
  });
});

describe("audit event API", () => {
  test("records actor, organization, outcome, and request", async () => {
    const { app, authService, databaseAdapter } = createMinimalHonoApp();
    const fetchApp = app as unknown as AppFetch;
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
    const created = (await createResponse.json()) as {
      organization: { id: string };
    };

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
    const payload = (await listResponse.json()) as {
      events: Array<{
        action: string;
        actorUserId: string | null;
        metadata: Record<string, unknown>;
        orgId: string | null;
        requestId: string | null;
        resourceId: string | null;
      }>;
    };
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

  test("blocks organization admins from reading the ledger", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp();
    const fetchApp = app as unknown as AppFetch;
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
