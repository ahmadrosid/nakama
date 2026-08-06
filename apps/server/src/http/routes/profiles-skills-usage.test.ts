import { describe, expect, test } from "bun:test";
import { createHonoApp } from "../app";
import { AuthService } from "../../services/auth-service";
import { OrgService } from "../../services/org-service";
import { ProfileService } from "../../services/profile-service";
import { SkillUsageService } from "../../services/skill-usage-service";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { loginPlatformAdminSession, setupFreshInstallSession } from "../test-session-helpers";
import { setupTestConfigDir } from "../../test-config-dir";

setupTestConfigDir("nakama-profiles-skills-usage-test-");

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const authService = new AuthService();
  const profileService = new ProfileService(databaseAdapter);
  return {
    databaseAdapter,
    authService,
    profileService,
    skillUsageService: new SkillUsageService(databaseAdapter),
    app: createHonoApp({
      agent: {
        getProfile: (orgId: string, profileId: string) => profileService.getProfile(orgId, profileId),
      } as never,
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

const BASE = "http://localhost:4310";

describe("profile skills usage API", () => {
  test("GET profile returns usage and createdBy on assigned skills", async () => {
    const { app, databaseAdapter, skillUsageService } = createApp();
    const session = await setupFreshInstallSession(app, databaseAdapter, "admin@org.com");
    const orgId = session.orgId!;
    const profileId = (await databaseAdapter.listProfilesForOrg(orgId))[0]!.id;
    const now = new Date().toISOString();
    const skillId = "skill_deploy";

    await databaseAdapter.upsertSkill({
      id: skillId,
      name: "deploy-checklist",
      description: "Deploy steps",
      sourcePath: `/tmp/${skillId}`,
      hasTool: false,
      disableModelInvocation: false,
      enabled: true,
      createdBy: "agent",
      createdAt: now,
      updatedAt: now,
    });
    await databaseAdapter.assignSkillToProfile(profileId, skillId);
    await skillUsageService.recordMatches(orgId, profileId, [skillId]);
    await skillUsageService.recordPatch(orgId, profileId, skillId);

    const resp = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}`, {
        headers: session.headers({}, orgId),
      }),
    );
    expect(resp.status).toBe(200);

    const body = (await resp.json()) as {
      profile: {
        skills: Array<{
          id: string;
          createdBy: string;
          usage?: { useCount: number; patchCount: number };
        }>;
      };
    };
    const skill = body.profile.skills.find((entry) => entry.id === skillId);
    expect(skill).toBeDefined();
    expect(skill!.createdBy).toBe("agent");
    expect(skill!.usage?.useCount).toBe(1);
    expect(skill!.usage?.patchCount).toBe(1);
  });

  test("skill without usage row omits usage object", async () => {
    const { app, databaseAdapter } = createApp();
    const session = await setupFreshInstallSession(app, databaseAdapter, "admin2@org.com");
    const orgId = session.orgId!;
    const profileId = (await databaseAdapter.listProfilesForOrg(orgId))[0]!.id;
    const now = new Date().toISOString();
    const skillId = "skill_fresh";

    await databaseAdapter.upsertSkill({
      id: skillId,
      name: "fresh-skill",
      description: "Never used",
      sourcePath: `/tmp/${skillId}`,
      hasTool: false,
      disableModelInvocation: false,
      enabled: true,
      createdBy: "human",
      createdAt: now,
      updatedAt: now,
    });
    await databaseAdapter.assignSkillToProfile(profileId, skillId);

    const resp = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}`, {
        headers: session.headers({}, orgId),
      }),
    );
    expect(resp.status).toBe(200);

    const body = (await resp.json()) as {
      profile: { skills: Array<{ id: string; createdBy: string; usage?: unknown }> };
    };
    const skill = body.profile.skills.find((entry) => entry.id === skillId);
    expect(skill?.createdBy).toBe("human");
    expect(skill?.usage).toEqual({
      viewCount: 0,
      useCount: 0,
      patchCount: 0,
      lastViewedAt: null,
      lastUsedAt: null,
      lastPatchedAt: null,
    });
  });

  test("cross-org profile access returns 404", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const orgASession = await setupFreshInstallSession(app, databaseAdapter, "org-a@org.com");
    const orgAId = orgASession.orgId!;
    const profileId = (await databaseAdapter.listProfilesForOrg(orgAId))[0]!.id;

    const platformSession = await loginPlatformAdminSession(app, authService, databaseAdapter);
    const createResp = await app.fetch(
      new Request(`${BASE}/v1/platform/orgs`, {
        method: "POST",
        headers: platformSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        body: JSON.stringify({
          name: "Org B",
          slug: "org-b-usage",
          admin: {
            name: "Org B Admin",
            email: "org-b@org.com",
            phone: "+628123456789",
          },
        }),
      }),
    );
    expect(createResp.status).toBe(201);
    const created = (await createResp.json()) as { organization: { id: string } };
    const orgBId = created.organization.id;

    const resp = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}`, {
        headers: orgASession.headers({}, orgBId),
      }),
    );
    expect(resp.status).toBe(404);
  });
});
