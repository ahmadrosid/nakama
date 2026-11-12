import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

setupTestConfigDir("nakama-org-invites-test-");

const BASE = "http://localhost:4310";

describe("org invite routes", () => {
  test("org admins list and revoke pending invites, members cannot", async () => {
    const { app, authService, databaseAdapter } = createMinimalHonoApp({
      databaseAdapter: createInMemoryDatabaseAdapter(),
    });

    const admin = await seedOrgAdmin(databaseAdapter, {
      authService,
      email: "admin@acme.com",
      orgId: "org_acme",
      userId: "user_admin",
    });

    const member = await seedOrgAdmin(databaseAdapter, {
      authService,
      email: "member@acme.com",
      orgId: "org_acme",
      role: "member",
      userId: "user_member",
    });

    await databaseAdapter.createOrgInvite({
      acceptedAt: null,
      createdAt: new Date().toISOString(),
      email: "guest@acme.com",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      id: "invite_1",
      invitedByUserId: "user_admin",
      orgId: "org_acme",
      revokedAt: null,
      role: "member",
      tokenHash: "hash_1",
    });

    const call = async (
      session: Awaited<ReturnType<typeof loginUserSession>>,
      method: "DELETE" | "GET",
      path: string
    ) =>
      await app.fetch(
        new Request(`${BASE}/v1/orgs/org_acme/invites${path}`, {
          headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
          method,
        })
      );

    const adminSession = await loginUserSession(
      app,
      admin.email,
      admin.password,
      admin.orgId
    );

    const memberSession = await loginUserSession(
      app,
      member.email,
      member.password,
      member.orgId
    );

    expect((await call(memberSession, "GET", "")).status).toBe(403);
    expect((await call(memberSession, "DELETE", "/invite_1")).status).toBe(403);

    const listed = await call(adminSession, "GET", "");
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      invites: [{ email: "guest@acme.com", id: "invite_1" }],
    });

    expect((await call(adminSession, "DELETE", "/invite_1")).status).toBe(204);
    expect(await (await call(adminSession, "GET", "")).json()).toEqual({
      invites: [],
    });
  });
  test("an accepted invite waits for an org admin when approval is on", async () => {
    const { app, authService, databaseAdapter } = createMinimalHonoApp({
      databaseAdapter: createInMemoryDatabaseAdapter(),
    });

    const admin = await seedOrgAdmin(databaseAdapter, {
      authService,
      email: "admin@acme.com",
      orgId: "org_acme",
      userId: "user_admin",
    });

    const member = await seedOrgAdmin(databaseAdapter, {
      authService,
      email: "member@acme.com",
      orgId: "org_acme",
      role: "member",
      userId: "user_member",
    });

    const adminSession = await loginUserSession(
      app,
      admin.email,
      admin.password,
      admin.orgId
    );

    const memberSession = await loginUserSession(
      app,
      member.email,
      member.password,
      member.orgId
    );

    const call = (
      session: Awaited<ReturnType<typeof loginUserSession>>,
      method: string,
      path: string,
      body?: { memberApprovalRequired: boolean }
    ) =>
      app.fetch(
        new Request(`${BASE}/v1/orgs/org_acme${path}`, {
          body: body === undefined ? undefined : JSON.stringify(body),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method,
        })
      );

    expect(
      (await call(adminSession, "PATCH", "", { memberApprovalRequired: true }))
        .status
    ).toBe(200);

    await databaseAdapter.createOrgInvite({
      acceptedAt: null,
      createdAt: new Date().toISOString(),
      email: "guest@acme.com",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      id: "invite_guest",
      invitedByUserId: "user_admin",
      orgId: "org_acme",
      revokedAt: null,
      role: "member",
      tokenHash: authService.hashToken("tok_guest"),
    });

    const accepted = await app.fetch(
      new Request(`${BASE}/v1/auth/accept-invite`, {
        body: JSON.stringify({ password: "guest-pass-1", token: "tok_guest" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    // No session: the pending user cannot reach any org route
    expect(accepted.status).toBe(202);
    expect(accepted.headers.get("set-cookie")).toBeNull();
    expect(await accepted.json()).toMatchObject({ pending: true });

    const listed = await call(adminSession, "GET", "/join-requests");
    const [request] = (await listed.json()).requests;
    expect(request).toMatchObject({ email: "guest@acme.com", role: "member" });

    const approve = `/join-requests/${request.userId}/approve`;
    expect((await call(memberSession, "POST", approve)).status).toBe(403);
    expect(
      await databaseAdapter.getOrgMember("org_acme", request.userId)
    ).toBeNull();

    expect((await call(adminSession, "POST", approve)).status).toBe(204);
    expect(
      (await databaseAdapter.getOrgMember("org_acme", request.userId))?.role
    ).toBe("member");
  });
});
