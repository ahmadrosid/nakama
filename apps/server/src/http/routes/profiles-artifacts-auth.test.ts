import { describe, expect, test } from "bun:test";
import type { AuthService as AuthServiceType } from "../../services/auth-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginPlatformAdminSession,
  loginUserSession,
  setupFreshInstallSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-profiles-artifacts-auth-test-");

function createApp() {
  const readCalls: Array<{ render?: "markdown" }> = [];
  const agent = {
    deleteProfileArtifact: async () => ({
      deleted: true,
      filename: "report.md",
      profileId: "profile_1",
    }),
    listProfileArtifacts: async () => ({
      artifacts: [],
      directory: "/tmp/artifacts",
      profileId: "profile_1",
    }),
    readProfileArtifact: async (
      _orgId: string,
      _profileId: string,
      _filename: string,
      options: { render?: "markdown" } = {}
    ) => {
      readCalls.push(options);
      return {
        bytes: new TextEncoder().encode("# Report"),
        contentType: "text/markdown",
      };
    },
  };

  return {
    ...createMinimalHonoApp({ agent }),
    readCalls,
  };
}

async function createOrgAdminSession(
  app: ReturnType<typeof createApp>["app"],
  authService: AuthServiceType,
  databaseAdapter: ReturnType<typeof createInMemoryDatabaseAdapter>,
  slug: string,
  email: string
) {
  const platformSession = await loginPlatformAdminSession(
    app,
    authService,
    databaseAdapter
  );

  const createResponse = await app.fetch(
    new Request("http://localhost:4310/v1/platform/orgs", {
      body: JSON.stringify({
        admin: {
          email,
          name: "Acme Admin",
          phone: "+628123456789",
        },
        name: "Acme",
        slug,
      }),
      headers: platformSession.headers({
        "Content-Type": "application/json",
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

  return {
    adminSession: await loginUserSession(
      app,
      email,
      created.adminMember.temporaryPassword,
      created.organization.id
    ),
    orgId: created.organization.id,
  };
}

describe("profile artifact content auth", () => {
  test("org member can read artifact content", async () => {
    const { app, databaseAdapter } = createApp();
    const memberSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "member@example.com",
      "member"
    );

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/profile_1/artifacts/content?path=report.md&inline=1",
        {
          headers: memberSession.headers({}, memberSession.orgId),
        }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown");
    expect(response.headers.get("Content-Disposition")).toContain("inline");
    expect(await response.text()).toBe("# Report");
  });

  test("org viewer can read artifact content", async () => {
    const { app, databaseAdapter } = createApp();
    const viewerSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "viewer@example.com",
      "viewer"
    );

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/profile_1/artifacts/content?path=report.md",
        {
          headers: viewerSession.headers({}, viewerSession.orgId),
        }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
  });

  test("forwards render=markdown so a .docx is converted for preview", async () => {
    const { app, databaseAdapter, readCalls } = createApp();
    const memberSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "render@example.com",
      "member"
    );

    const response = await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/profile_1/artifacts/content?path=laporan.docx&inline=1&render=markdown",
        {
          headers: memberSession.headers({}, memberSession.orgId),
        }
      )
    );

    expect(response.status).toBe(200);
    expect(readCalls.at(-1)?.render).toBe("markdown");
  });

  test("serves raw bytes when render is not requested", async () => {
    const { app, databaseAdapter, readCalls } = createApp();
    const memberSession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "raw@example.com",
      "member"
    );

    await app.fetch(
      new Request(
        "http://localhost:4310/v1/profiles/profile_1/artifacts/content?path=laporan.docx",
        {
          headers: memberSession.headers({}, memberSession.orgId),
        }
      )
    );

    expect(readCalls.at(-1)?.render).toBeUndefined();
  });

  test("org member cannot list artifacts", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const { orgId, adminSession } = await createOrgAdminSession(
      app,
      authService,
      databaseAdapter,
      "acme-artifact-member",
      "admin-artifact-member@acme.com"
    );

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "member-artifact@acme.com",
          name: "Member One",
          phone: "+628111111111",
          role: "member",
        }),
        headers: adminSession.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(addMemberResponse.status).toBe(201);
    const memberProvisioned = (await addMemberResponse.json()) as {
      temporaryPassword: string;
    };
    const memberSession = await loginUserSession(
      app,
      "member-artifact@acme.com",
      memberProvisioned.temporaryPassword,
      orgId
    );

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/profiles/profile_1/artifacts", {
        headers: memberSession.headers({}, orgId),
      })
    );

    expect(response.status).toBe(403);
  });

  test("platform admin can still list artifacts", async () => {
    const { app, databaseAdapter } = createApp();
    const adminSession = await setupFreshInstallSession(app, databaseAdapter);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/profiles/profile_1/artifacts", {
        headers: adminSession.headers({}, adminSession.orgId),
      })
    );

    expect(response.status).toBe(200);
  });
});
