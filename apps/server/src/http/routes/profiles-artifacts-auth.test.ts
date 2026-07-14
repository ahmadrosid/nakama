import { describe, expect, test } from "bun:test";
import { createHonoApp } from "../app";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { loginPlatformAdminSession, loginUserSession, setupFreshInstallSession } from "../test-session-helpers";
import { setupTestConfigDir } from "../../test-config-dir";
import type { AuthService as AuthServiceType } from "../../services/auth-service";

setupTestConfigDir("nakama-profiles-artifacts-auth-test-");

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const agent = {
    readProfileArtifact: async () => ({
      bytes: new TextEncoder().encode("# Report"),
      contentType: "text/markdown",
    }),
    listProfileArtifacts: async () => ({
      profileId: "profile_1",
      directory: "/tmp/artifacts",
      artifacts: [],
    }),
    deleteProfileArtifact: async () => ({
      deleted: true,
      profileId: "profile_1",
      filename: "report.md",
    }),
  };

  return {
    databaseAdapter,
    authService,
    app: createHonoApp({
      agent: agent as never,
      automationService: {} as never,
      taskService: {} as never,
      systemStatus: { getStatus: async () => ({ ok: true }) } as never,
      workerManager: {} as never,
      mcpService: {} as never,
      authService,
      orgService: new OrgService(databaseAdapter, authService),
      databaseAdapter,
      webDistDir: null,
    }),
  };
}

async function createOrgAdminSession(
  app: ReturnType<typeof createApp>["app"],
  authService: AuthServiceType,
  databaseAdapter: ReturnType<typeof createInMemoryDatabaseAdapter>,
  slug: string,
  email: string,
) {
  const platformSession = await loginPlatformAdminSession(app, authService, databaseAdapter);

  const createResponse = await app.fetch(
    new Request("http://localhost:4310/v1/platform/orgs", {
      method: "POST",
      headers: platformSession.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": platformSession.csrfToken,
      }),
      body: JSON.stringify({
        name: "Acme",
        slug,
        admin: {
          name: "Acme Admin",
          email,
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

  return {
    orgId: created.organization.id,
    adminSession: await loginUserSession(
      app,
      email,
      created.adminMember.temporaryPassword,
      created.organization.id,
    ),
  };
}

describe("profile artifact content auth", () => {
  test("org member can read artifact content", async () => {
    const { app, databaseAdapter } = createApp();
    const memberSession = await setupFreshInstallSession(app, databaseAdapter, "member@example.com", "member");

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/profile_1/artifacts/content?path=report.md&inline=1",
        {
          headers: memberSession.headers({}, memberSession.orgId),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown");
    expect(response.headers.get("Content-Disposition")).toContain("inline");
    expect(await response.text()).toBe("# Report");
  });

  test("org viewer can read artifact content", async () => {
    const { app, databaseAdapter } = createApp();
    const viewerSession = await setupFreshInstallSession(app, databaseAdapter, "viewer@example.com", "viewer");

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/profiles/profile_1/artifacts/content?path=report.md", {
        headers: viewerSession.headers({}, viewerSession.orgId),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
  });

  test("org member cannot list artifacts", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-artifact-member",
      "admin-artifact-member@acme.com",
    );

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        method: "POST",
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId,
        ),
        body: JSON.stringify({
          name: "Member One",
          email: "member-artifact@acme.com",
          phone: "+628111111111",
          role: "member",
        }),
      }),
    );

    expect(addMemberResponse.status).toBe(201);
    const memberProvisioned = (await addMemberResponse.json()) as { temporaryPassword: string };
    const memberSession = await loginUserSession(
      app,
      "member-artifact@acme.com",
      memberProvisioned.temporaryPassword,
      orgId,
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/profiles/profile_1/artifacts", {
        headers: memberSession.headers({}, orgId),
      }),
    );

    expect(response.status).toBe(403);
  });

  test("platform admin can still list artifacts", async () => {
    const { app, databaseAdapter } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/profiles/profile_1/artifacts", {
        headers: adminSession.headers({}, adminSession.orgId),
      }),
    );

    expect(response.status).toBe(200);
  });
});
