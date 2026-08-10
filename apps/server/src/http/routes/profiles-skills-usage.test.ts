import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { ProfileService } from "../../services/profile-service";
import { SkillUsageService } from "../../services/skill-usage-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginPlatformAdminSession,
  setupFreshInstallSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-profiles-skills-usage-test-");

function createApp() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const profileService = new ProfileService(databaseAdapter);
  return {
    ...createMinimalHonoApp({
      agent: {
        getProfile: (orgId: string, profileId: string) =>
          profileService.getProfile(orgId, profileId),
      },
      databaseAdapter,
    }),
    profileService,
    skillUsageService: new SkillUsageService(databaseAdapter),
  };
}

const BASE = "http://localhost:4310";

describe("profile skills usage API", () => {
  test("GET profile returns usage and createdBy on assigned skills", async () => {
    const { app, databaseAdapter, skillUsageService } = createApp();
    const session = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin@org.com"
    );
    const orgId = session.orgId!;
    const profileId = (await databaseAdapter.listProfilesForOrg(orgId))[0]!.id;
    const now = new Date().toISOString();
    const skillId = "skill_deploy";

    await databaseAdapter.upsertSkill({
      createdAt: now,
      createdBy: "agent",
      description: "Deploy steps",
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id: skillId,
      name: "deploy-checklist",
      sourcePath: `/tmp/${skillId}`,
      updatedAt: now,
    });
    await databaseAdapter.assignSkillToProfile(profileId, skillId);
    await skillUsageService.recordMatches(orgId, profileId, [skillId]);
    await skillUsageService.recordPatch(orgId, profileId, skillId);

    const resp = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}`, {
        headers: session.headers({}, orgId),
      })
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
    const session = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "admin2@org.com"
    );
    const orgId = session.orgId!;
    const profileId = (await databaseAdapter.listProfilesForOrg(orgId))[0]!.id;
    const now = new Date().toISOString();
    const skillId = "skill_fresh";

    await databaseAdapter.upsertSkill({
      createdAt: now,
      createdBy: "human",
      description: "Never used",
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id: skillId,
      name: "fresh-skill",
      sourcePath: `/tmp/${skillId}`,
      updatedAt: now,
    });
    await databaseAdapter.assignSkillToProfile(profileId, skillId);

    const resp = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}`, {
        headers: session.headers({}, orgId),
      })
    );
    expect(resp.status).toBe(200);

    const body = (await resp.json()) as {
      profile: {
        skills: Array<{ id: string; createdBy: string; usage?: unknown }>;
      };
    };
    const skill = body.profile.skills.find((entry) => entry.id === skillId);
    expect(skill?.createdBy).toBe("human");
    expect(skill?.usage).toEqual({
      lastPatchedAt: null,
      lastUsedAt: null,
      lastViewedAt: null,
      patchCount: 0,
      useCount: 0,
      viewCount: 0,
    });
  });

  test("cross-org profile access returns 404", async () => {
    const { app, authService, databaseAdapter } = createApp();
    const orgASession = await setupFreshInstallSession(
      app,
      databaseAdapter,
      "org-a@org.com"
    );
    const orgAId = orgASession.orgId!;
    const profileId = (await databaseAdapter.listProfilesForOrg(orgAId))[0]!.id;

    const platformSession = await loginPlatformAdminSession(
      app,
      authService,
      databaseAdapter
    );
    const createResp = await app.fetch(
      new Request(`${BASE}/v1/platform/orgs`, {
        body: JSON.stringify({
          admin: {
            email: "org-b@org.com",
            name: "Org B Admin",
            phone: "+628123456789",
          },
          name: "Org B",
          slug: "org-b-usage",
        }),
        headers: platformSession.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": platformSession.csrfToken,
        }),
        method: "POST",
      })
    );
    expect(createResp.status).toBe(201);
    const created = (await createResp.json()) as {
      organization: { id: string };
    };
    const orgBId = created.organization.id;

    const resp = await app.fetch(
      new Request(`${BASE}/v1/profiles/${profileId}`, {
        headers: orgASession.headers({}, orgBId),
      })
    );
    expect(resp.status).toBe(404);
  });
});
