import { describe, expect, test } from "bun:test";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  getKnowledgeBaseManifestPath,
  getOrgKnowledgeBaseDir,
  getProfileSoulDir,
  resolveProfileSkillDirectory,
  saveUserConfig,
  uploadOrganizationKnowledgeBaseDocument,
} from "@nakama/core";
import type {
  CreateOrganizationResponse,
  CreateTeamRequest,
  ListOrgMembersResponse,
  ListOrgSharedResourcesResponse,
  OrganizationOverviewResponse,
  OrgSharedResourceResponse,
  ProfileResponse,
  PublishOrgSharedResourceRequest,
} from "@nakama/core/contract";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { ProfileService } from "../services/profile-service";
import { setupTestConfigDir } from "../test-config-dir";
import { createMinimalHonoApp } from "./test-app-helpers";
import {
  loginPlatformAdminSession,
  loginUserSession,
  setupFreshInstallSession,
} from "./test-session-helpers";

setupTestConfigDir("nakama-org-members-test-");

test("shared agent selection returns stable team profiles and enforces invocation access", async () => {
  const db = createInMemoryDatabaseAdapter();
  const profileService = new ProfileService(db);

  const { app, authService, orgService } = createMinimalHonoApp({
    agent: {
      getProfile: (orgId: string, profileId: string) =>
        profileService.getProfile(orgId, profileId),
    },
    databaseAdapter: db,
  });

  const now = new Date().toISOString();

  for (const id of ["org_parent", "org_team_a", "org_team_b", "org_other"]) {
    await db.upsertOrganization({
      createdAt: now,
      id,
      name: id,
      parentOrgId: id.startsWith("org_team") ? "org_parent" : null,
      slug: id.replace(/_/g, "-"),
      updatedAt: now,
    });
  }

  for (const id of ["user_reader", "user_parent_admin"]) {
    await db.createUser({
      createdAt: now,
      email: `${id}@example.com`,
      id,
      passwordHash: await authService.hashPassword("password123"),
      updatedAt: now,
    });
  }

  for (const orgId of ["org_team_a", "org_team_b", "org_other"]) {
    await db.upsertOrgMember({
      createdAt: now,
      orgId,
      role: "member",
      userId: "user_reader",
    });
  }

  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_parent",
    role: "admin",
    userId: "user_parent_admin",
  });

  const source = {
    createdAt: now,
    id: "profile_template",
    isDefault: false,
    isSuper: false,
    model: null,
    name: "Template",
    orgId: "org_parent",
    systemPrompt: "Published instructions",
    updatedAt: now,
  };

  await db.upsertProfile(source);
  const sourceDir = getProfileSoulDir(source.orgId, source.id);
  await mkdir(sourceDir, { recursive: true });

  for (const file of ["MEMORY.md", "USER.md", "private.txt"]) {
    await writeFile(join(sourceDir, file), `Private ${file}`);
  }

  const publication = await orgService.publishSharedResource(
    "org_parent",
    { resourceId: source.id, resourceKind: "agent" },
    "user_parent_admin"
  );

  const session = await loginUserSession(
    app,
    "user_reader@example.com",
    "password123",
    "org_team_a"
  );

  const post = (
    pathOrg = "org_team_a",
    publicationId = publication.id,
    activeOrg = "org_team_a"
  ) =>
    app.fetch(
      new Request(
        `http://localhost:4310/v1/orgs/${pathOrg}/shared-agents/${publicationId}/instance`,
        {
          body: JSON.stringify({
            parentOrgId: "org_other",
            profileId: source.id,
          }),
          headers: session.headers(
            {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            },
            activeOrg
          ),
          method: "POST",
        }
      )
    );

  const responses = await Promise.all([post(), post(), post()]);
  const results: ProfileResponse[] = [];

  for (const response of responses) {
    expect(response.status).toBe(200);
    results.push(await response.json());
  }

  const profileId = results[0]?.profile.id;
  expect(profileId).toBeTruthy();

  if (!profileId) {
    throw new Error("Missing team profile");
  }

  expect(new Set(results.map((result) => result.profile.id)).size).toBe(1);
  expect(profileId).not.toBe(source.id);
  expect(await db.getProfileForOrg(profileId, "org_team_a")).toBeTruthy();
  expect(await db.getProfileForOrg(profileId, "org_parent")).toBeNull();
  expect(results[0]?.profile).toMatchObject({
    acpAgent: null,
    mcpServers: [],
    name: source.name,
    skills: [],
    systemPrompt: source.systemPrompt,
    tools: [],
  });
  expect(await db.listProfilesForOrg("org_team_a")).toHaveLength(1);
  const teamDir = getProfileSoulDir("org_team_a", profileId);
  expect(await readdir(teamDir)).toEqual([]);
  await writeFile(join(teamDir, "MEMORY.md"), "Team memory");
  expect((await post()).status).toBe(200);
  expect(await readFile(join(teamDir, "MEMORY.md"), "utf8")).toBe(
    "Team memory"
  );
  const savedTeamDir = `${teamDir}-saved`;
  await rename(teamDir, savedTeamDir);
  await symlink(sourceDir, teamDir);
  const failedSetup = await post();
  expect(failedSetup.status).toBe(500);
  expect(JSON.stringify(await failedSetup.json())).not.toContain(sourceDir);
  expect(await db.listProfilesForOrg("org_team_a")).toHaveLength(1);
  await rm(teamDir);
  await rename(savedTeamDir, teamDir);
  expect((await post()).status).toBe(200);
  expect(await readFile(join(teamDir, "MEMORY.md"), "utf8")).toBe(
    "Team memory"
  );
  const sibling = await post("org_team_b", publication.id, "org_team_b");
  expect(sibling.status).toBe(200);
  const siblingResult: ProfileResponse = await sibling.json();
  expect(siblingResult.profile.id).not.toBe(profileId);
  expect(
    await db.getProfileForOrg(siblingResult.profile.id, "org_team_b")
  ).toBeTruthy();
  expect((await post("org_team_b")).status).toBe(404);
  expect((await post("org_team_a", source.id)).status).toBe(404);
  expect((await post("org_team_a", "missing")).status).toBe(404);
  await db.upsertTool({
    createdAt: now,
    description: "Published tool",
    handlerConfig: {},
    handlerType: "bash",
    id: "published-tool",
    name: "published-tool",
    orgId: "org_parent",
    updatedAt: now,
  });

  const wrongKind = await db.publishOrgSharedResource({
    createdAt: now,
    id: "wrong-kind",
    orgId: "org_parent",
    resourceId: "published-tool",
    resourceKind: "tool",
    updatedAt: now,
  });

  expect((await post("org_team_a", wrongKind.id)).status).toBe(404);
  expect((await post("org_other", publication.id, "org_other")).status).toBe(
    409
  );
  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_team_a",
    role: "member",
    userId: "user_reader",
  });
  expect((await post()).status).toBe(200);
  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_team_a",
    role: "member",
    userId: "user_reader",
  });

  const csrf = await app.fetch(
    new Request(
      `http://localhost:4310/v1/orgs/org_team_a/shared-agents/${publication.id}/instance`,
      { headers: session.headers({}, "org_team_a"), method: "POST" }
    )
  );

  expect(csrf.status).toBe(403);

  const parentSession = await loginUserSession(
    app,
    "user_parent_admin@example.com",
    "password123",
    "org_parent"
  );

  for (const [orgId, expected] of [
    ["org_team_a", 404],
    ["org_parent", 409],
  ] as const) {
    const response = await app.fetch(
      new Request(
        `http://localhost:4310/v1/orgs/${orgId}/shared-agents/${publication.id}/instance`,
        {
          headers: parentSession.headers(
            { "X-CSRF-Token": parentSession.csrfToken },
            orgId
          ),
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(expected);
  }

  await db.upsertProfile({
    ...source,
    acpAgent: { args: ["--token", "parent-secret"], command: "agent" },
  });
  const unsupported = await post();
  expect(unsupported.status).toBe(409);
  expect(JSON.stringify(await unsupported.json())).not.toContain(
    "parent-secret"
  );
  await db.upsertProfile(source);
  await orgService.unpublishSharedResource(
    "org_parent",
    publication.id,
    "user_parent_admin"
  );
  expect((await post()).status).toBe(404);
  expect(await readFile(join(teamDir, "MEMORY.md"), "utf8")).toBe(
    "Team memory"
  );

  for (const file of ["MEMORY.md", "USER.md", "private.txt"]) {
    expect(await readFile(join(sourceDir, file), "utf8")).toBe(
      `Private ${file}`
    );
  }

  const republished = await orgService.publishSharedResource(
    "org_parent",
    { resourceId: source.id, resourceKind: "agent" },
    "user_parent_admin"
  );

  const recovered = await post("org_team_a", republished.id);
  expect(recovered.status).toBe(200);
  const recoveredResult: ProfileResponse = await recovered.json();
  expect(recoveredResult.profile.id).toBe(profileId);
  expect(await db.listProfilesForOrg("org_team_a")).toHaveLength(1);
  await db.deleteOrgMember("org_team_a", "user_reader");
  expect((await post("org_team_a", republished.id)).status).toBe(404);

  const specResponse = await app.fetch(
    new Request("http://localhost:4310/openapi.json")
  );

  const spec = await specResponse.json();
  expect(
    spec.paths["/v1/orgs/{orgId}/shared-agents/{publicationId}/instance"].post
      .responses["200"]
  ).toBeTruthy();
});

test("organization overview filters teams, counts local additions, and preserves tenant boundaries", async () => {
  const {
    app,
    authService,
    databaseAdapter: db,
    orgService,
  } = createMinimalHonoApp();

  const now = new Date().toISOString();

  for (const id of ["org_parent", "org_other", "org_team_a", "org_team_b"]) {
    await db.upsertOrganization({
      allowedInviteDomains: ["private-domain.example"],
      createdAt: now,
      id,
      monthlyLlmTokenLimit: 123_456,
      name: id,
      parentOrgId: id.startsWith("org_team") ? "org_parent" : null,
      slug: id.replace(/_/g, "-"),
      updatedAt: now,
    });
  }

  for (const id of ["user_reader", "user_parent_admin", "user_other_member"]) {
    await db.createUser({
      createdAt: now,
      email: `${id}@example.com`,
      id,
      passwordHash: await authService.hashPassword("password123"),
      updatedAt: now,
    });
  }

  for (const [orgId, userId, role] of [
    ["org_team_a", "user_reader", "member"],
    ["org_team_a", "user_other_member", "member"],
    ["org_team_b", "user_other_member", "admin"],
    ["org_parent", "user_parent_admin", "admin"],
  ] as const) {
    await db.upsertOrgMember({ createdAt: now, orgId, role, userId });
  }

  for (const [id, orgId, isDefault, isSuper] of [
    ["profile_local", "org_team_a", false, false],
    ["profile_default", "org_team_a", true, false],
    ["profile_super", "org_team_a", false, true],
    ["profile_template", "org_parent", false, false],
    ["profile_foreign", "org_other", false, false],
  ] as const) {
    await db.upsertProfile({
      createdAt: now,
      id,
      isDefault,
      isSuper,
      model: null,
      name: id,
      orgId,
      systemPrompt: "Private instructions",
      updatedAt: now,
    });
  }

  const agentPublication = await orgService.publishSharedResource(
    "org_parent",
    { resourceId: "profile_template", resourceKind: "agent" },
    "user_parent_admin"
  );

  await db.createSharedAgentInstance(
    "org_team_a",
    agentPublication.id,
    "profile_shared",
    now
  );

  for (const [id, orgId] of [
    ["tool_local", "org_team_a"],
    ["tool_parent", "org_parent"],
    ["tool_global", null],
    ["tool_foreign", "org_other"],
  ] as const) {
    await db.upsertTool({
      createdAt: now,
      description: "Private description",
      handlerConfig: { token: "private-token" },
      handlerType: "bash",
      id,
      name: id,
      orgId,
      updatedAt: now,
    });
  }

  await orgService.publishSharedResource(
    "org_parent",
    { resourceId: "tool_parent", resourceKind: "tool" },
    "user_parent_admin"
  );

  for (const [id, orgId, enabled] of [
    ["skill_local", "org_team_a", true],
    ["skill_disabled", "org_team_a", false],
    ["skill_global", null, true],
    ["skill_foreign", "org_other", true],
  ] as const) {
    await db.upsertSkill({
      createdAt: now,
      createdBy: "human",
      description: "Private description",
      disableModelInvocation: false,
      enabled,
      hasTool: false,
      id,
      name: id,
      orgId,
      sourcePath: `/private/${id}`,
      updatedAt: now,
    });
  }

  await uploadOrganizationKnowledgeBaseDocument("org_team_a", {
    data: Buffer.from("Private team knowledge").toString("base64"),
    filename: "private-team-file.txt",
    mediaType: "text/plain",
  });

  const session = await loginUserSession(
    app,
    "user_reader@example.com",
    "password123"
  );

  await db.beginOrgTeamCreation({
    adminUserId: "user_reader",
    creatorUserId: "user_parent_admin",
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

  const get = (pathOrg: string, activeOrg = pathOrg, query = "") =>
    app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${pathOrg}/overview${query}`, {
        headers: session.headers({}, activeOrg),
      })
    );

  const countOrgs: string[] = [];
  const getCounts = db.getOrganizationResourceCounts;
  db.getOrganizationResourceCounts = (id) => {
    countOrgs.push(id);

    return getCounts(id);
  };

  const response = await get("org_team_a");
  expect(response.status).toBe(200);
  const result: OrganizationOverviewResponse = await response.json();
  expect(result).toMatchObject({
    activeOrgId: "org_team_a",
    canManageOrganization: false,
    organization: { id: "org_parent", name: "org_parent" },
  });
  expect(result.teams).toEqual([
    {
      canSwitch: true,
      id: "org_team_a",
      isCurrent: true,
      localResourceCounts: { agents: 1, knowledge: 1, skills: 2, tools: 1 },
      memberCount: 2,
      name: "org_team_a",
      slug: "org-team-a",
    },
  ]);
  expect(countOrgs).toEqual(["org_team_a"]);
  db.getOrganizationResourceCounts = getCounts;
  expect(
    result.sharedResources.map((entry) => entry.resourceKind).sort()
  ).toEqual(["agent", "tool"]);
  const serialized = JSON.stringify(result);

  for (const secret of [
    "org_team_b",
    "org_other",
    "private-token",
    "private-domain.example",
    "private-team-file.txt",
    "Private instructions",
    "user_other_member@example.com",
    "/private/skill_local",
  ]) {
    expect(serialized).not.toContain(secret);
  }

  expect(Object.keys(result.organization).sort()).toEqual(["id", "name"]);

  const manifestPath = getKnowledgeBaseManifestPath(
    getOrgKnowledgeBaseDir("org_team_a")
  );

  const manifest = await readFile(manifestPath, "utf8");
  const foreignDir = getOrgKnowledgeBaseDir("org_other");
  const foreignManifest = getKnowledgeBaseManifestPath(foreignDir);
  await mkdir(foreignDir, { recursive: true });
  await writeFile(foreignManifest, "{}");
  await rm(manifestPath);
  await symlink(foreignManifest, manifestPath);

  try {
    const failed = await get("org_team_a");
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain(foreignManifest);
  } finally {
    await rm(manifestPath);
    await writeFile(manifestPath, manifest);
  }

  expect(await (await get("org_team_a")).json()).toEqual(result);
  expect(
    await (
      await get("org_team_a", "org_team_a", "?parentOrgId=org_other")
    ).json()
  ).toEqual(result);
  expect((await get("org_parent", "org_team_a")).status).toBe(404);
  expect((await get("org_team_b", "org_team_a")).status).toBe(404);
  expect((await get("org_other")).status).toBe(404);
  await expect(
    orgService.getOrganizationOverview("org_parent", "user_reader")
  ).rejects.toMatchObject({ status: 404 });
  expect(await db.getOrganizationResourceCounts("org_missing")).toBeNull();

  for (const role of ["admin"] as const) {
    await db.upsertOrgMember({
      createdAt: now,
      orgId: "org_team_a",
      role,
      userId: "user_reader",
    });
    expect(await (await get("org_team_a")).json()).toEqual(result);
  }

  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_team_b",
    role: "member",
    userId: "user_reader",
  });

  const sibling: OrganizationOverviewResponse = await (
    await get("org_team_a")
  ).json();

  expect(sibling.teams.map((team) => team.id)).toEqual([
    "org_team_a",
    "org_team_b",
  ]);
  expect(sibling.teams[1]).toMatchObject({
    canSwitch: true,
    isCurrent: false,
    localResourceCounts: { agents: 0, knowledge: 0, skills: 0, tools: 0 },
    memberCount: 2,
  });
  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_parent",
    role: "member",
    userId: "user_reader",
  });

  const rootReader: OrganizationOverviewResponse = await (
    await get("org_parent")
  ).json();

  expect(rootReader.canManageOrganization).toBe(false);
  expect(rootReader.teams.every((team) => !team.isCurrent)).toBe(true);

  const parentAdmin = await orgService.getOrganizationOverview(
    "org_parent",
    "user_parent_admin"
  );

  expect(parentAdmin.canManageOrganization).toBe(true);
  expect(parentAdmin.teams.map((team) => team.id)).toEqual([
    "org_team_a",
    "org_team_b",
  ]);
  expect(parentAdmin.teams.every((team) => !team.canSwitch)).toBe(true);
  await expect(
    orgService.getOrganizationOverview("org_team_a", "user_parent_admin")
  ).rejects.toMatchObject({ status: 404 });
  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_team_a",
    role: "member",
    userId: "user_parent_admin",
  });

  const adminTeam = await orgService.getOrganizationOverview(
    "org_team_a",
    "user_parent_admin"
  );

  expect(adminTeam.canManageOrganization).toBe(false);
  expect(adminTeam.teams[0]).toMatchObject({
    canSwitch: true,
    isCurrent: true,
    memberCount: 3,
  });
  expect(adminTeam.teams[1].canSwitch).toBe(false);
  await db.deleteTool("tool_local");
  await db.deleteSkill("skill_local");
  await db.deleteProfile("profile_local");

  const changed: OrganizationOverviewResponse = await (
    await get("org_team_a")
  ).json();

  expect(changed.teams[0].localResourceCounts).toEqual({
    agents: 0,
    knowledge: 1,
    skills: 1,
    tools: 0,
  });
  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_other",
    role: "admin",
    userId: "user_reader",
  });

  const standalone: OrganizationOverviewResponse = await (
    await get("org_other")
  ).json();

  expect(standalone).toEqual({
    activeOrgId: "org_other",
    canManageOrganization: true,
    organization: { id: "org_other", name: "org_other" },
    sharedResources: [],
    teams: [],
  });
  const platform = await loginPlatformAdminSession(app, authService, db);

  const platformResponse = await app.fetch(
    new Request("http://localhost:4310/v1/orgs/org_parent/overview", {
      headers: platform.headers({}, "org_parent"),
    })
  );

  const platformResult: OrganizationOverviewResponse =
    await platformResponse.json();

  expect(platformResponse.status).toBe(200);
  expect(platformResult.canManageOrganization).toBe(true);
  expect(platformResult.teams.every((team) => team.canSwitch)).toBe(true);
  const teamB = await db.getOrganizationById("org_team_b");
  await db.upsertOrganization({ ...teamB!, archivedAt: now });

  const archived = await orgService.getOrganizationOverview(
    "org_parent",
    "user_parent_admin"
  );

  expect(archived.teams.map((team) => team.id)).toEqual(["org_team_a"]);
  await db.disableUser("user_reader", now);
  await expect(
    orgService.getOrganizationOverview("org_team_a", "user_reader")
  ).rejects.toMatchObject({ status: 404 });

  const openapi = await app.fetch(
    new Request("http://localhost:4310/openapi.json")
  );

  const spec = await openapi.json();
  expect(
    spec.paths["/v1/orgs/{orgId}/overview"].get.responses["200"]
  ).toBeTruthy();
  expect(
    spec.components.schemas.OrganizationOverviewResponse.properties.teams.items
      .properties.memberCount.type
  ).toBe("integer");
});

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

  const post = (body: string) =>
    app.fetch(
      new Request("http://localhost:4310/v1/orgs/org_parent/shared-resources", {
        body,
        headers,
        method: "POST",
      })
    );

  expect(await db.listOrgSharedResources("org_parent")).toEqual([]);

  for (const request of requests) {
    const response = await post(JSON.stringify(request));
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
    const retry = await post(JSON.stringify(request));
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(result);

    const listed = await app.fetch(
      new Request("http://localhost:4310/v1/orgs/org_parent/shared-resources", {
        headers: session.headers({}, "org_parent"),
      })
    );

    expect(listed.status).toBe(200);
    const summaries: ListOrgSharedResourcesResponse = await listed.json();
    expect(summaries.resources).toEqual([
      {
        ...result.publication,
        label: {
          agent: "Source",
          knowledge: "source.txt",
          model: "source-model",
          skill: "source-skill",
          tool: "source-tool",
        }[request.resourceKind],
        readiness: "ready",
        sourceOrganization: { id: "org_parent", name: "Parent" },
      },
    ]);
    const serialized = JSON.stringify(summaries);
    expect(serialized).not.toContain("private-source-token");
    expect(serialized).not.toContain("private-provider-key");
    expect(serialized).not.toContain(skillPath);

    if (request.resourceKind === "skill") {
      await rm(join(skillPath, "SKILL.md"));

      const unavailable = await app.fetch(
        new Request(
          "http://localhost:4310/v1/orgs/org_parent/shared-resources",
          {
            headers: session.headers({}, "org_parent"),
          }
        )
      );

      const missing: ListOrgSharedResourcesResponse = await unavailable.json();
      expect(missing.resources[0]).toMatchObject({
        id: result.publication.id,
        label: request.resourceId,
        readiness: "unavailable",
      });
      await writeFile(join(skillPath, "SKILL.md"), content);
    }

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
    expect((await post(JSON.stringify(body))).status).toBe(400);
  }

  expect(
    (
      await post(
        JSON.stringify({ resourceId: "missing", resourceKind: "tool" })
      )
    ).status
  ).toBe(404);
});

test("publication lists derive the active team's parent and enforce read access", async () => {
  const {
    app,
    authService,
    databaseAdapter: db,
    orgService,
  } = createMinimalHonoApp();

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
    email: "reader@example.com",
    id: "user_reader",
    passwordHash: await authService.hashPassword("password123"),
    updatedAt: now,
  });

  for (const orgId of ["org_team_a", "org_team_b", "org_other"]) {
    await db.upsertOrgMember({
      createdAt: now,
      orgId,
      role: "member",
      userId: "user_reader",
    });
  }

  for (const [id, orgId] of [
    ["tool_published", "org_parent"],
    ["tool_private", "org_parent"],
    ["tool_other", "org_other"],
  ]) {
    await db.upsertTool({
      createdAt: now,
      description: "Private description",
      handlerConfig: { token: "private-token" },
      handlerType: "bash",
      id,
      name: id,
      orgId,
      updatedAt: now,
    });
  }

  for (const [id, orgId, resourceId] of [
    ["publication_parent", "org_parent", "tool_published"],
    ["publication_other", "org_other", "tool_other"],
  ]) {
    await db.publishOrgSharedResource({
      createdAt: now,
      id,
      orgId,
      resourceId,
      resourceKind: "tool",
      updatedAt: now,
    });
  }

  const session = await loginUserSession(
    app,
    "reader@example.com",
    "password123"
  );

  const get = (pathOrg: string, activeOrg = pathOrg, query = "") =>
    app.fetch(
      new Request(
        `http://localhost:4310/v1/orgs/${pathOrg}/shared-resources${query}`,
        { headers: session.headers({}, activeOrg) }
      )
    );

  const first = await get("org_team_a");
  expect(first.status).toBe(200);
  const result: ListOrgSharedResourcesResponse = await first.json();
  expect(result.resources).toEqual([
    {
      createdAt: now,
      id: "publication_parent",
      label: "tool_published",
      orgId: "org_parent",
      readiness: "ready",
      resourceId: "tool_published",
      resourceKind: "tool",
      sourceOrganization: { id: "org_parent", name: "org_parent" },
      updatedAt: now,
    },
  ]);
  expect(await (await get("org_team_b")).json()).toEqual(result);
  expect(
    await (
      await get("org_team_a", "org_team_a", "?parentOrgId=org_other")
    ).json()
  ).toEqual(result);
  expect((await get("org_parent", "org_team_a")).status).toBe(404);
  expect((await get("org_team_b", "org_team_a")).status).toBe(404);
  expect((await get("org_parent")).status).toBe(404);
  expect(
    (
      await orgService.listSharedResources("org_other", "user_reader")
    ).resources.map((entry) => entry.id)
  ).toEqual(["publication_other"]);
  await expect(
    orgService.listSharedResources("org_parent", "user_reader")
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    orgService.listSharedResources("org_team_a", "user_missing")
  ).rejects.toMatchObject({ status: 404 });

  for (const role of ["member"] as const) {
    await db.upsertOrgMember({
      createdAt: now,
      orgId: "org_parent",
      role,
      userId: "user_reader",
    });
    expect(await (await get("org_parent")).json()).toEqual(result);
  }

  await db.deleteOrgMember("org_team_b", "user_reader");
  expect((await get("org_team_b")).status).toBe(404);
  await expect(
    orgService.listSharedResources("org_team_b", "user_reader")
  ).rejects.toMatchObject({ status: 404 });
  const platform = await loginPlatformAdminSession(app, authService, db);

  const platformList = await app.fetch(
    new Request("http://localhost:4310/v1/orgs/org_team_b/shared-resources", {
      headers: platform.headers({}, "org_team_b"),
    })
  );

  expect(platformList.status).toBe(200);
  expect(await platformList.json()).toEqual(result);
  await db.upsertTool({
    ...(await db.getTool("tool_published"))!,
    name: "Changed source name",
    orgId: "org_other",
  });

  const invalid: ListOrgSharedResourcesResponse = await (
    await get("org_team_a")
  ).json();

  expect(invalid.resources[0]).toMatchObject({
    label: "tool_published",
    readiness: "unavailable",
  });
  expect(JSON.stringify(invalid)).not.toContain("Changed source name");
  await db.deleteOrgSharedResource("org_parent", "publication_parent");
  expect(await (await get("org_team_a")).json()).toEqual({ resources: [] });
  const getOrganizationById = db.getOrganizationById;
  db.getOrganizationById = async (id) => {
    const record = await getOrganizationById(id);

    return record && id === "org_parent"
      ? { ...record, archivedAt: now }
      : record;
  };

  try {
    expect((await get("org_team_a")).status).toBe(404);
    await expect(
      orgService.listSharedResources("org_team_a", "user_reader")
    ).rejects.toMatchObject({ status: 404 });
  } finally {
    db.getOrganizationById = getOrganizationById;
  }

  await db.disableUser("user_reader", now);
  await expect(
    orgService.listSharedResources("org_team_a", "user_reader")
  ).rejects.toMatchObject({ status: 404 });

  const openapi = await app.fetch(
    new Request("http://localhost:4310/openapi.json")
  );

  const spec = await openapi.json();
  expect(
    spec.paths["/v1/orgs/{orgId}/shared-resources"].get.responses["200"]
  ).toBeTruthy();
  expect(
    spec.components.schemas.ListOrgSharedResourcesResponse.properties.resources
      .items.properties.readiness.enum
  ).toEqual(["ready", "requires_setup", "unavailable"]);
});

test("publication HTTP mutations deny team admins, members, and wrong tenant context", async () => {
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
  ) => {
    const headers = session.headers(
      { "Content-Type": "application/json" },
      activeOrg
    );

    if (csrf) {
      headers["X-CSRF-Token"] = session.csrfToken;
    }

    const init: RequestInit = { headers, method };

    if (method === "POST") {
      init.body = JSON.stringify(request);
    }

    return app.fetch(
      new Request(
        `http://localhost:4310/v1/orgs/${pathOrg}/shared-resources${method === "DELETE" ? `/${publicationId}` : ""}`,
        init
      )
    );
  };

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

  for (const role of ["member"] as const) {
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

  const post = (body: CreateTeamRequest) =>
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

test("team admins list parent members who are not yet in the team", async () => {
  const { app, authService, databaseAdapter: db } = createMinimalHonoApp();
  const now = new Date().toISOString();

  for (const id of ["org_parent", "org_team"]) {
    await db.upsertOrganization({
      createdAt: now,
      id,
      name: id,
      parentOrgId: id === "org_team" ? "org_parent" : null,
      slug: id.replace(/_/g, "-"),
      updatedAt: now,
    });
  }

  for (const id of ["user_admin", "user_member", "user_free"]) {
    await db.createUser({
      createdAt: now,
      email: `${id}@example.com`,
      id,
      name: id,
      passwordHash: await authService.hashPassword("password123"),
      phone: "+1000",
      updatedAt: now,
    });
  }

  for (const [orgId, userId, role] of [
    ["org_parent", "user_admin", "admin"],
    ["org_parent", "user_member", "member"],
    ["org_parent", "user_free", "member"],
    ["org_team", "user_admin", "admin"],
    ["org_team", "user_member", "member"],
  ] as const) {
    await db.upsertOrgMember({ createdAt: now, orgId, role, userId });
  }

  const list = async (email: string, orgId: string, path = orgId) => {
    const session = await loginUserSession(app, email, "password123");

    return app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${path}/parent-members`, {
        headers: session.headers({}, orgId),
      })
    );
  };

  const ok = await list("user_admin@example.com", "org_team");
  expect(ok.status).toBe(200);

  const body: ListOrgMembersResponse = await ok.json();

  expect(body.members.map((member) => member.userId)).toEqual(["user_free"]);
  expect(body.members[0].phone).toBeNull();
  expect((await list("user_member@example.com", "org_team")).status).toBe(403);
  expect((await list("user_admin@example.com", "org_parent")).status).toBe(404);
  expect(
    (await list("user_admin@example.com", "org_team", "org_parent")).status
  ).toBe(404);
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
    body: string,
    pathOrg = "org_parent",
    activeOrg = "org_parent",
    csrf = true
  ) => {
    const headers = session.headers(
      { "Content-Type": "application/json" },
      activeOrg
    );

    if (csrf) {
      headers["X-CSRF-Token"] = session.csrfToken;
    }

    return app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${pathOrg}/teams`, {
        body,
        headers,
        method: "POST",
      })
    );
  };

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
    expect(
      (await post(JSON.stringify({ ...request, ...changes }))).status
    ).toBe(400);
  }

  expect(
    (await db.listOrganizations()).filter(
      (org) => org.parentOrgId === "org_parent"
    )
  ).toEqual([]);
  expect((await post(JSON.stringify(request), "org_other")).status).toBe(404);
  expect(
    (await post(JSON.stringify(request), "org_other", "org_other")).status
  ).toBe(404);
  expect(
    (await post(JSON.stringify(request), "org_parent", "org_parent", false))
      .status
  ).toBe(403);

  for (const role of ["member"] as const) {
    await db.upsertOrgMember({
      createdAt: now,
      orgId: "org_parent",
      role,
      userId: "user_creator",
    });
    expect((await post(JSON.stringify(request))).status).toBe(403);
  }

  await db.upsertOrgMember({
    createdAt: now,
    orgId: "org_parent",
    role: "admin",
    userId: "user_creator",
  });
  const child = await post(JSON.stringify(request));
  expect(child.status).toBe(201);
  const created: CreateOrganizationResponse = await child.json();
  expect(
    (
      await post(
        JSON.stringify({ ...request, requestId: "nested", slug: "nested" }),
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
  test("removed viewer role cannot create members, invites, or role changes", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;
    const before = await databaseAdapter.listOrgMembers(orgId);

    for (const [method, path] of [
      ["POST", `/v1/orgs/${orgId}/members`],
      ["POST", `/v1/orgs/${orgId}/invites`],
      ["PATCH", `/v1/orgs/${orgId}/members/${before[0]!.userId}`],
      ["POST", `/v1/platform/orgs/${orgId}/invites`],
    ]) {
      const response = await app.fetch(
        new Request(`http://localhost:4310${path}`, {
          body: JSON.stringify({
            email: "removed-role@example.com",
            name: "Removed role",
            role: "viewer",
          }),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method,
        })
      );

      expect(response.status).toBe(400);
    }

    expect(await databaseAdapter.listOrgMembers(orgId)).toEqual(before);
    expect(
      await databaseAdapter.getUserByEmail("removed-role@example.com")
    ).toBeNull();
    expect(
      await databaseAdapter.getPendingOrgInvite(
        orgId,
        "removed-role@example.com"
      )
    ).toBeNull();
  });

  test("member can read org data but not list or manage members", async () => {
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

    const addSecondaryMemberResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "member@acme.com",
          name: "Member One",
          phone: "+628111111111",
          role: "member",
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

    expect(addSecondaryMemberResponse.status).toBe(201);

    // SAFETY: The test checks this response against the endpoint contract asserted below.
    const secondaryMemberProvisioned =
      (await addSecondaryMemberResponse.json()) as {
        temporaryPassword: string;
      };

    const secondaryMemberSession = await loginUserSession(
      app,
      "member@acme.com",
      secondaryMemberProvisioned.temporaryPassword
    );

    const profilesResponse = await app.fetch(
      new Request("http://localhost:4310/v1/profiles", {
        headers: secondaryMemberSession.headers({}, orgId),
      })
    );

    expect(profilesResponse.status).toBe(200);

    const listMembersResponse = await app.fetch(
      new Request(`http://localhost:4310/v1/orgs/${orgId}/members`, {
        headers: secondaryMemberSession.headers({}, orgId),
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
        headers: secondaryMemberSession.headers(
          {
            "X-CSRF-Token": secondaryMemberSession.csrfToken,
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
          role: "member",
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
