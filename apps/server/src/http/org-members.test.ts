import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { setupTestConfigDir } from "../test-config-dir";
import { createHonoApp } from "./app";
import {
  loginPlatformAdminSession,
  loginUserSession,
} from "./test-session-helpers";

setupTestConfigDir("nakama-org-members-test-");

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  return {
    app: createHonoApp({
      agent: {
        listProfiles: async () => ({ profiles: [{ id: "default" }] }),
      } as any,
      authService,
      automationService: {} as any,
      databaseAdapter,
      mcpService: {} as any,
      orgService: new OrgService(databaseAdapter, authService),
      systemStatus: { getStatus: async () => ({ ok: true }) } as any,
      taskService: {} as any,
      webDistDir: null,
      workerManager: {} as any,
    }),
    authService,
    databaseAdapter,
  };
}

describe("org member management (AE2)", () => {
  test("viewer can read org data but not list or manage members", async () => {
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
    const orgId = created.organization.id;

    const adminSession = await loginUserSession(
      app,
      "admin@acme.com",
      created.adminMember.temporaryPassword
    );

    const addViewerResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "viewer@acme.com",
          name: "Viewer One",
          phone: "+628111111111",
          role: "viewer",
        }),
        headers: adminSession.headers(
          {
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(addViewerResponse.status).toBe(201);
    const viewerProvisioned = (await addViewerResponse.json()) as {
      temporaryPassword: string;
    };
    const viewerSession = await loginUserSession(
      app,
      "viewer@acme.com",
      viewerProvisioned.temporaryPassword
    );

    const profilesResponse = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: viewerSession.headers({}, orgId),
      })
    );
    expect(profilesResponse.status).toBe(200);

    const listMembersResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        headers: viewerSession.headers({}, orgId),
      })
    );
    expect(listMembersResponse.status).toBe(403);

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "blocked@acme.com",
          name: "Blocked",
          phone: "+628222222222",
          role: "member",
        }),
        headers: viewerSession.headers(
          {
            "X-CSRF-Token": viewerSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );
    expect(addMemberResponse.status).toBe(403);
  });

  test("org admin can list, edit, change role, and remove members", async () => {
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
            email: "admin-mgmt@acme.com",
            name: "Acme Admin",
            phone: "+628123456789",
          },
          name: "Acme",
          slug: "acme-mgmt",
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
      "admin-mgmt@acme.com",
      created.adminMember.temporaryPassword
    );

    const addMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "member-mgmt@acme.com",
          name: "Member One",
          phone: "+628987654321",
          role: "viewer",
        }),
        headers: adminSession.headers(
          {
            "X-CSRF-Token": adminSession.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );
    const added = (await addMemberResponse.json()) as {
      member: { userId: string };
    };

    const listResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        headers: adminSession.headers({}, orgId),
      })
    );
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as {
      members: Array<{ email: string }>;
    };
    expect(listed.members).toHaveLength(2);
    expect(listed.members.map((member) => member.email).sort()).toEqual([
      "admin-mgmt@acme.com",
      "member-mgmt@acme.com",
    ]);

    const patchResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/orgs/${orgId}/members/${added.member.userId}`,
        {
          body: JSON.stringify({
            name: "Member Prime",
            phone: "+628111222333",
            role: "member",
          }),
          headers: adminSession.headers(
            {
              "X-CSRF-Token": adminSession.csrfToken,
            },
            orgId
          ),
          method: "PATCH",
        }
      )
    );
    expect(patchResponse.status).toBe(200);
    const patched = (await patchResponse.json()) as {
      member: { role: string; name: string; phone: string };
    };
    expect(patched.member.name).toBe("Member Prime");
    expect(patched.member.phone).toBe("+628111222333");
    expect(patched.member.role).toBe("member");

    const deleteResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/orgs/${orgId}/members/${added.member.userId}`,
        {
          headers: adminSession.headers(
            {
              "X-CSRF-Token": adminSession.csrfToken,
            },
            orgId
          ),
          method: "DELETE",
        }
      )
    );
    expect(deleteResponse.status).toBe(204);

    const afterDelete = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        headers: adminSession.headers({}, orgId),
      })
    );
    const remaining = (await afterDelete.json()) as {
      members: Array<{ email: string }>;
    };
    expect(remaining.members).toHaveLength(1);
    expect(remaining.members.map((member) => member.email).sort()).toEqual([
      "admin-mgmt@acme.com",
    ]);
  });
});
