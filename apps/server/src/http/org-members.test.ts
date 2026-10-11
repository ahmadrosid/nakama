import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  resolveProfileSkillDirectory,
  saveUserConfig,
  uploadOrganizationKnowledgeBaseDocument,
} from "@nakama/core";
import type {
  CreateOrganizationResponse,
  OrgSharedResourceResponse,
  PublishOrgSharedResourceRequest,
} from "@nakama/core/contract";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import { setupTestConfigDir } from "../test-config-dir";
import { createMinimalHonoApp } from "./test-app-helpers";
import {
  loginPlatformAdminSession,
  loginUserSession,
} from "./test-session-helpers";

setupTestConfigDir("nakama-org-members-test-");

test("publication HTTP mutations validate all resource kinds and preserve source data", async () => {
  const { app, authService, databaseAdapter: db } = createMinimalHonoApp();
  const now = new Date().toISOString();
  await db.upsertOrganization({
    createdAt: now,
    id: "org_parent",
    name: "Parent",
    slug: "parent",
    updatedAt: now,
  });
  await db.createUser({
    createdAt: now,
    email: "publisher@example.com",
    id: "user_publisher",
    passwordHash: await authService.hashPassword("password123"),
    updatedAt: now,
  });
  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_parent",
    role: "admin",
    userId: "user_publisher",
  });
  const session = await loginUserSession(
    app,
    "publisher@example.com",
    "password123"
  );
  const headers = session.headers(
    { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
    "org_parent"
  );
  await db.upsertProfile({
    createdAt: now,
    id: "profile_source",
    isDefault: false,
    isSuper: false,
    model: null,
    name: "Source",
    orgId: "org_parent",
    systemPrompt: "Instructions",
    updatedAt: now,
  });
  await db.upsertTool({
    createdAt: now,
    description: "Test",
    handlerConfig: { token: "private-source-token" },
    handlerType: "bash",
    id: "tool_source",
    name: "source-tool",
    orgId: "org_parent",
    updatedAt: now,
  });
  const skillPath = resolveProfileSkillDirectory(
    "org_parent",
    "profile_source",
    "source-skill"
  );
  await mkdir(skillPath, { recursive: true });
  const content =
    "---\nname: source-skill\ndescription: Test\n---\nInstructions";
  await writeFile(join(skillPath, "SKILL.md"), content);
  await db.upsertSkill({
    createdAt: now,
    createdBy: "human",
    description: "Test",
    disableModelInvocation: false,
    enabled: true,
    hasTool: false,
    id: "skill_source",
    name: "source-skill",
    orgId: "org_parent",
    sourcePath: skillPath,
    updatedAt: now,
  });
  const { document } = await uploadOrganizationKnowledgeBaseDocument(
    "org_parent",
    {
      data: Buffer.from("Knowledge").toString("base64"),
      filename: "source.txt",
      mediaType: "text/plain",
    }
  );
  await saveUserConfig({
    defaultProviderId: "provider_source",
    providers: [
      {
        apiKey: "private-provider-key",
        createdAt: now,
        customModels: [{ id: "source-model" }],
        id: "provider_source",
        label: "Source",
        type: "ollama",
      },
    ],
    thinkingEffort: "medium",
    thinkingEnabled: true,
  });
  const requests: PublishOrgSharedResourceRequest[] = [
    { resourceId: document.id, resourceKind: "knowledge" },
    { resourceId: "skill_source", resourceKind: "skill" },
    { resourceId: "profile_source", resourceKind: "agent" },
    { resourceId: "tool_source", resourceKind: "tool" },
    { resourceId: "provider_source::source-model", resourceKind: "model" },
  ];
  const post = (body: unknown) =>
    app.fetch(
      new Request("http://localhost:4310/v1/orgs/org_parent/shared-resources", {
        body: JSON.stringify(body),
        headers,
        method: "POST",
      })
    );
  expect(await db.listOrgSharedResources("org_parent")).toEqual([]);
  for (const request of requests) {
    const response = await post(request);
    expect(response.status).toBe(201);
    const result: OrgSharedResourceResponse = await response.json();
    expect(result.publication).toMatchObject({
      ...request,
      orgId: "org_parent",
    });
    expect(Object.keys(result.publication).sort()).toEqual([
      "createdAt",
      "id",
      "orgId",
      "resourceId",
      "resourceKind",
      "updatedAt",
    ]);
    const retry = await post(request);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(result);
    for (let attempt = 0; attempt < 2; attempt++) {
      const removed = await app.fetch(
        new Request(
          `http://localhost:4310/v1/orgs/org_parent/shared-resources/${result.publication.id}`,
          { headers, method: "DELETE" }
        )
      );
      expect(removed.status).toBe(204);
      expect(await removed.text()).toBe("");
    }
  }
  expect(await db.listOrgSharedResources("org_parent")).toEqual([]);
  expect(await readFile(join(skillPath, "SKILL.md"), "utf8")).toBe(content);
  expect((await db.getTool("tool_source"))?.handlerConfig).toEqual({
    token: "private-source-token",
  });
  expect(await db.getProfile("profile_source")).toBeTruthy();
  for (const body of [
    { resourceId: "tool_source", resourceKind: "unknown" },
    { resourceId: "", resourceKind: "tool" },
    { resourceId: 12, resourceKind: "tool" },
    {
      parentOrgId: "org_other",
      resourceId: "tool_source",
      resourceKind: "tool",
    },
  ]) {
    expect((await post(body)).status).toBe(400);
  }
  expect(
    (await post({ resourceId: "missing", resourceKind: "tool" })).status
  ).toBe(404);
});

test("publication HTTP mutations deny team admins, members, viewers, and wrong tenant context", async () => {
  const { app, authService, databaseAdapter: db } = createMinimalHonoApp();
  const now = new Date().toISOString();
  for (const id of ["org_parent", "org_other", "org_team_a", "org_team_b"]) {
    await db.upsertOrganization({
      createdAt: now,
      id,
      name: id,
      parentOrgId: id.startsWith("org_team") ? "org_parent" : null,
      slug: id.replace(/_/g, "-"),
      updatedAt: now,
    });
  }
  await db.createUser({
    createdAt: now,
    email: "publisher@example.com",
    id: "user_publisher",
    passwordHash: await authService.hashPassword("password123"),
    updatedAt: now,
  });
  for (const orgId of ["org_parent", "org_other", "org_team_a", "org_team_b"]) {
    await db.upsertOrgMember({
      createdAt: now,
      orgId,
      role: "admin",
      userId: "user_publisher",
    });
  }
  await db.upsertTool({
    createdAt: now,
    description: "Test",
    handlerConfig: {},
    handlerType: "bash",
    id: "tool_source",
    name: "Source",
    orgId: "org_parent",
    updatedAt: now,
  });
  const session = await loginUserSession(
    app,
    "publisher@example.com",
    "password123"
  );
  const request = { resourceId: "tool_source", resourceKind: "tool" };
  const send = (
    method: "POST" | "DELETE",
    pathOrg: string,
    activeOrg: string,
    publicationId = "missing",
    csrf = true
  ) =>
    app.fetch(
      new Request(
        `http://localhost:4310/v1/orgs/${pathOrg}/shared-resources${method === "DELETE" ? `/${publicationId}` : ""}`,
        {
          ...(method === "POST" ? { body: JSON.stringify(request) } : {}),
          headers: session.headers(
            {
              "Content-Type": "application/json",
              ...(csrf ? { "X-CSRF-Token": session.csrfToken } : {}),
            },
            activeOrg
          ),
          method,
        }
      )
    );
  const created = await send("POST", "org_parent", "org_parent");
  expect(created.status).toBe(201);
  const { publication }: OrgSharedResourceResponse = await created.json();
  for (const orgId of ["org_team_a", "org_team_b"]) {
    for (const method of ["POST", "DELETE"] as const) {
      expect(
        (await send(method, "org_parent", orgId, publication.id)).status
      ).toBe(404);
      expect((await send(method, orgId, orgId, publication.id)).status).toBe(
        409
      );
    }
  }
  expect(
    (await send("DELETE", "org_other", "org_other", publication.id)).status
  ).toBe(204);
  expect((await send("POST", "org_other", "org_other")).status).toBe(404);
  for (const role of ["member", "viewer"] as const) {
    await db.upsertOrgMember({
      createdAt: now,
      orgId: "org_parent",
      role,
      userId: "user_publisher",
    });
    for (const method of ["POST", "DELETE"] as const) {
      expect(
        (await send(method, "org_parent", "org_parent", publication.id)).status
      ).toBe(403);
    }
  }
  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_parent",
    role: "admin",
    userId: "user_publisher",
  });
  for (const method of ["POST", "DELETE"] as const) {
    expect(
      (await send(method, "org_parent", "org_parent", publication.id, false))
        .status
    ).toBe(403);
  }
  expect(await db.listOrgSharedResources("org_parent")).toEqual([publication]);
  const platform = await loginPlatformAdminSession(app, authService, db);
  const platformPublish = await app.fetch(
    new Request("http://localhost:4310/v1/orgs/org_parent/shared-resources", {
      body: JSON.stringify(request),
      headers: platform.headers(
        {
          "Content-Type": "application/json",
          "X-CSRF-Token": platform.csrfToken,
        },
        "org_parent"
      ),
      method: "POST",
    })
  );
  expect(platformPublish.status).toBe(201);
  expect(await platformPublish.json()).toEqual({ publication });
  const specResponse = await app.fetch(
    new Request("http://localhost:4310/openapi.json")
  );
  expect(specResponse.status).toBe(200);
  const spec = await specResponse.json();
  expect(
    spec.components.schemas.PublishOrgSharedResourceRequest.properties
      .resourceKind.enum
  ).toEqual(["knowledge", "skill", "agent", "tool", "model"]);
  expect(
    spec.paths["/v1/orgs/{orgId}/shared-resources/{publicationId}"].delete
      .responses["204"]
  ).toBeTruthy();
});

test("team creation uses existing accounts, preserves selection, and recovers retries", async () => {
  const { app, authService, databaseAdapter: db } = createMinimalHonoApp();
  const now = new Date().toISOString();
  await db.upsertOrganization({
    createdAt: now,
    id: "org_parent",
    name: "Parent",
    slug: "parent",
    updatedAt: now,
  });
  for (const id of ["user_creator", "user_selected"]) {
    await db.createUser({
      createdAt: now,
      email: `${id}@example.com`,
      id,
      passwordHash: await authService.hashPassword("password123"),
      updatedAt: now,
    });
  }
  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_parent",
    role: "admin",
    userId: "user_creator",
  });
  const session = await loginUserSession(
    app,
    "user_creator@example.com",
    "password123"
  );
  const request = { name: "Team", requestId: "team-request", slug: "team" };
  const post = (body: unknown) =>
    app.fetch(
      new Request("http://localhost:4310/v1/orgs/org_parent/teams", {
        body: JSON.stringify(body),
        headers: session.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          "org_parent"
        ),
        method: "POST",
      })
    );
  const response = await post(request);
  expect(response.status).toBe(201);
  const created: CreateOrganizationResponse = await response.json();
  expect(created.organization.parentOrgId).toBe("org_parent");
  expect(created.adminMember).toMatchObject({
    member: { role: "admin", userId: "user_creator" },
    temporaryPassword: null,
  });
  const retry = await post(request);
  expect(retry.status).toBe(201);
  expect(await retry.json()).toEqual(created);
  expect(await db.listProfilesForOrg(created.organization.id)).toHaveLength(2);
  expect(
    (await db.listOrganizations()).filter(
      (org) => org.parentOrgId === "org_parent"
    )
  ).toHaveLength(1);
  const conflict = await post({ ...request, name: "Changed" });
  expect(conflict.status).toBe(409);
  const selected = await post({
    ...request,
    adminUserId: "user_selected",
    requestId: "selected-request",
    slug: "selected-team",
  });
  expect(selected.status).toBe(201);
  const other: CreateOrganizationResponse = await selected.json();
  expect(other.adminMember?.member.userId).toBe("user_selected");
  expect(
    await db.getOrgMember(other.organization.id, "user_creator")
  ).toBeNull();
  expect(
    (await db.listOrgMembers(other.organization.id))
      .filter((entry) => entry.userId !== LOCAL_CLIENT_USER_ID)
      .map((entry) => entry.userId)
  ).toEqual(["user_selected"]);
  expect(await db.getUserById("user_selected")).toBeTruthy();
  const me = await app.fetch(
    new Request("http://localhost:4310/v1/auth/me", {
      headers: session.headers(),
    })
  );
  expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({ activeOrgId: "org_parent" });
});

test("team creation rejects invalid bodies, roles, contexts, and nested teams", async () => {
  const { app, authService, databaseAdapter: db } = createMinimalHonoApp();
  const now = new Date().toISOString();
  for (const id of ["org_parent", "org_other"]) {
    await db.upsertOrganization({
      createdAt: now,
      id,
      name: id,
      slug: id.replace(/_/g, "-"),
      updatedAt: now,
    });
  }
  await db.createUser({
    createdAt: now,
    email: "creator@example.com",
    id: "user_creator",
    passwordHash: await authService.hashPassword("password123"),
    updatedAt: now,
  });
  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_parent",
    role: "admin",
    userId: "user_creator",
  });
  const session = await loginUserSession(
    app,
    "creator@example.com",
    "password123"
  );
  const request = { name: "Team", requestId: "team-request", slug: "team" };
  const post = (
    body: unknown,
    pathOrg = "org_parent",
    activeOrg = "org_parent",
    csrf = true
  ) =>
    app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${pathOrg}/teams`, {
        body: JSON.stringify(body),
        headers: session.headers(
          {
            "Content-Type": "application/json",
            ...(csrf ? { "X-CSRF-Token": session.csrfToken } : {}),
          },
          activeOrg
        ),
        method: "POST",
      })
    );
  for (const changes of [
    { requestId: 12 },
    { requestId: "" },
    { name: null },
    { name: " " },
    { slug: "invalid slug" },
    { adminUserId: false },
    { adminUserId: "missing-user" },
    { parentOrgId: "org_other" },
    { admin: { email: "new@example.com" } },
  ]) {
    expect((await post({ ...request, ...changes })).status).toBe(400);
  }
  expect(
    (await db.listOrganizations()).filter(
      (org) => org.parentOrgId === "org_parent"
    )
  ).toEqual([]);
  expect((await post(request, "org_other")).status).toBe(404);
  expect((await post(request, "org_other", "org_other")).status).toBe(404);
  expect((await post(request, "org_parent", "org_parent", false)).status).toBe(
    403
  );
  for (const role of ["member", "viewer"] as const) {
    await db.upsertOrgMember({
      createdAt: now,
      orgId: "org_parent",
      role,
      userId: "user_creator",
    });
    expect((await post(request)).status).toBe(403);
  }
  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_parent",
    role: "admin",
    userId: "user_creator",
  });
  const child = await post(request);
  expect(child.status).toBe(201);
  const created: CreateOrganizationResponse = await child.json();
  expect(
    (
      await post(
        { ...request, requestId: "nested", slug: "nested" },
        created.organization.id,
        created.organization.id
      )
    ).status
  ).toBe(409);
  expect(
    (await db.listOrganizations()).filter(
      (org) => org.parentOrgId === created.organization.id
    )
  ).toEqual([]);
  const specResponse = await app.fetch(
    new Request("http://localhost:4310/openapi.json")
  );
  expect(specResponse.status).toBe(200);
  const spec = await specResponse.json();
  expect(
    spec.paths["/v1/orgs/{orgId}/teams"].post.requestBody.content[
      "application/json"
    ].schema.$ref
  ).toBe("#/components/schemas/CreateTeamRequest");
  expect(spec.components.schemas.CreateTeamRequest.required).toEqual([
    "name",
    "requestId",
    "slug",
  ]);
  expect(
    spec.components.schemas.CreateTeamResponse.properties.organization
      .properties.parentOrgId
  ).toBeTruthy();
});

describe("org member management (AE2)", () => {
  test("viewer can read org data but not list or manage members", async () => {
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

    // SAFETY: The test checks this response against the endpoint contract asserted below.
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

    // SAFETY: The test checks this response against the endpoint contract asserted below.
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

    // SAFETY: The test checks this response against the endpoint contract asserted below.
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

    // SAFETY: The test checks this response against the endpoint contract asserted below.
    const added = (await addMemberResponse.json()) as {
      member: { userId: string };
    };

    const listResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        headers: adminSession.headers({}, orgId),
      })
    );

    expect(listResponse.status).toBe(200);

    // SAFETY: The test checks this response against the endpoint contract asserted below.
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

    // SAFETY: The test checks this response against the endpoint contract asserted below.
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

    // SAFETY: The test checks this response against the endpoint contract asserted below.
    const remaining = (await afterDelete.json()) as {
      members: Array<{ email: string }>;
    };

    expect(remaining.members).toHaveLength(1);
    expect(remaining.members.map((member) => member.email).sort()).toEqual([
      "admin-mgmt@acme.com",
    ]);
  });

  test("remove member rejects invalid userId shape with 400", async () => {
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
            email: "admin-shape@acme.com",
            name: "Acme Admin",
            phone: "+628123456789",
          },
          name: "Acme Shape",
          slug: "acme-shape-http",
        }),
        headers: platformSession.headers({
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(createResponse.status).toBe(201);

    // SAFETY: The test checks this response against the endpoint contract asserted below.
    const created = (await createResponse.json()) as {
      organization: { id: string };
      adminMember: { temporaryPassword: string };
    };

    const orgId = created.organization.id;

    const adminSession = await loginUserSession(
      app,
      "admin-shape@acme.com",
      created.adminMember.temporaryPassword
    );

    const invalidMemberPathResponse = await app.fetch(
      new Request(
        `http://localhost:4310/v1/orgs/${orgId}/members/${encodeURIComponent("../nope")}`,
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

    expect(invalidMemberPathResponse.status).toBe(400);
  });
});

test("pending team setup blocks tenant requests even for platform admins", async () => {
  const { app, authService, databaseAdapter } = createMinimalHonoApp();
  const session = await loginPlatformAdminSession(
    app,
    authService,
    databaseAdapter
  );
  const user = (await databaseAdapter.listPlatformAdminUsers())[0];
  expect(user).toBeTruthy();
  const now = new Date().toISOString();
  await databaseAdapter.upsertOrganization({
    createdAt: now,
    id: "org_parent",
    name: "Parent",
    slug: "parent",
    updatedAt: now,
  });
  await databaseAdapter.beginOrgTeamCreation({
    adminUserId: user!.id,
    creatorUserId: user!.id,
    organization: {
      createdAt: now,
      id: "org_pending",
      name: "Pending",
      parentOrgId: "org_parent",
      slug: "pending",
      updatedAt: now,
    },
    requestHash: "hash",
    requestId: "pending-request",
  });
  const pending = await app.fetch(
    new Request("http://localhost:4310/v1/profiles", {
      headers: session.headers({}, "org_pending"),
    })
  );
  expect(pending.status).toBe(404);
  const parent = await app.fetch(
    new Request("http://localhost:4310/v1/profiles", {
      headers: session.headers({}, "org_parent"),
    })
  );
  expect(parent.status).toBe(200);
});
