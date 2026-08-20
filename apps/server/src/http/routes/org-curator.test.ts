import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadLocalAuthToken,
  pathExists,
  SKILL_ARCHIVE_DIR_NAME,
} from "@nakama/core";
import { seedOrgDefaultProfile } from "@nakama/db";
import { setupTestConfigDir } from "../../test-config-dir";
import { createMinimalHonoApp } from "../test-app-helpers";
import { seedLocalClientUser } from "../test-org-helpers";
import {
  loginUserSession,
  setupFreshInstallSession,
} from "../test-session-helpers";

setupTestConfigDir("nakama-org-curator-test-");

const BASE = "http://localhost:4310";
const NOW = new Date("2026-08-15T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("org curator routes", () => {
  test("org admin can run the curator and archive an eligible skill", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;
    const profile = (await databaseAdapter.listProfilesForOrg(orgId))[0]!;
    const skillId = await addUnusedSkill({
      configDir: process.env.NAKAMA_CONFIG_DIR!,
      db: databaseAdapter,
      name: "old-playbook",
      orgId,
      profileId: profile.id,
    });

    const response = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/curator/run`, {
        body: JSON.stringify({}),
        headers: session.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { archived: number } };
    expect(body.result.archived).toBe(1);
    expect(await databaseAdapter.listSkillsForProfile(profile.id)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: skillId })])
    );
    expect(
      await pathExists(
        join(
          process.env.NAKAMA_CONFIG_DIR!,
          "orgs",
          orgId,
          "profiles",
          profile.id,
          "skills",
          SKILL_ARCHIVE_DIR_NAME,
          "old-playbook"
        )
      )
    ).toBe(true);
  });

  test("returns 404 when the path org does not match the active org", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp();
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;

    const response = await app.fetch(
      new Request(`${BASE}/v1/orgs/org_other/curator/run`, {
        body: JSON.stringify({}),
        headers: session.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(404);
  });

  test("forbids members from running the curator", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp();
    const admin = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = admin.orgId!;

    const inviteResp = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/members`, {
        body: JSON.stringify({
          email: "member@org.com",
          name: "Member",
          role: "member",
        }),
        headers: admin.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": admin.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );
    const invited = (await inviteResp.json()) as { temporaryPassword: string };
    const member = await loginUserSession(
      app,
      "member@org.com",
      invited.temporaryPassword,
      orgId
    );

    const response = await app.fetch(
      new Request(`${BASE}/v1/orgs/${orgId}/curator/run`, {
        body: JSON.stringify({}),
        headers: member.headers(
          {
            "Content-Type": "application/json",
            "X-CSRF-Token": member.csrfToken,
          },
          orgId
        ),
        method: "POST",
      })
    );

    expect(response.status).toBe(403);
  });

  test("internal seed tick sets last_run_at and archives nothing", async () => {
    const { app, databaseAdapter, orgService } = createMinimalHonoApp();
    await seedLocalClientUser(databaseAdapter);
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;
    const profile = (await databaseAdapter.listProfilesForOrg(orgId))[0]!;
    await addUnusedSkill({
      configDir: process.env.NAKAMA_CONFIG_DIR!,
      db: databaseAdapter,
      name: "seed-me",
      orgId,
      profileId: profile.id,
    });
    await orgService.updateOrganization(orgId, { skillsCuratorEnabled: true });

    const token = await loadLocalAuthToken();
    const response = await app.fetch(
      new Request(`${BASE}/v1/internal/curator/orgs/${orgId}/run`, {
        body: JSON.stringify({ trigger: "seed" }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { archived: number; trigger: string };
    };
    expect(body.result.trigger).toBe("seed");
    expect(body.result.archived).toBe(0);
    const org = await orgService.getOrganization(orgId);
    expect(org?.skillsCuratorLastRunAt).toBeTruthy();
    expect(
      await pathExists(
        join(
          process.env.NAKAMA_CONFIG_DIR!,
          "orgs",
          orgId,
          "profiles",
          profile.id,
          "skills",
          "seed-me"
        )
      )
    ).toBe(true);
  });

  test("internal org list omits disabled orgs", async () => {
    const { app, databaseAdapter, orgService } = createMinimalHonoApp();
    await seedLocalClientUser(databaseAdapter);
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;
    await seedOrgDefaultProfile(databaseAdapter, "org_disabled");
    await databaseAdapter.upsertOrganization({
      createdAt: NOW.toISOString(),
      id: "org_disabled",
      name: "Disabled",
      skillsCuratorEnabled: false,
      slug: "disabled",
      updatedAt: NOW.toISOString(),
    });
    await orgService.updateOrganization(orgId, { skillsCuratorEnabled: true });

    const token = await loadLocalAuthToken();
    const response = await app.fetch(
      new Request(`${BASE}/v1/internal/curator/orgs`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { orgs: Array<{ id: string }> };
    expect(body.orgs.map((org) => org.id)).toEqual([orgId]);
  });

  test("internal org list omits archived orgs", async () => {
    const { app, databaseAdapter, orgService } = createMinimalHonoApp();
    await seedLocalClientUser(databaseAdapter);
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;
    await orgService.updateOrganization(orgId, { skillsCuratorEnabled: true });
    await databaseAdapter.upsertOrganization({
      ...(await databaseAdapter.getOrganizationById(orgId))!,
      archivedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });

    const token = await loadLocalAuthToken();
    const response = await app.fetch(
      new Request(`${BASE}/v1/internal/curator/orgs`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { orgs: Array<{ id: string }> };
    expect(body.orgs).toEqual([]);
  });

  test("internal curator run returns 404 for an archived org", async () => {
    const { app, databaseAdapter, orgService } = createMinimalHonoApp();
    await seedLocalClientUser(databaseAdapter);
    const session = await setupFreshInstallSession(app, databaseAdapter);
    const orgId = session.orgId!;
    await orgService.updateOrganization(orgId, { skillsCuratorEnabled: true });
    await databaseAdapter.upsertOrganization({
      ...(await databaseAdapter.getOrganizationById(orgId))!,
      archivedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });

    const token = await loadLocalAuthToken();
    const response = await app.fetch(
      new Request(`${BASE}/v1/internal/curator/orgs/${orgId}/run`, {
        body: JSON.stringify({ trigger: "schedule" }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(404);
  });
});

async function addUnusedSkill(input: {
  configDir: string;
  db: Parameters<typeof seedOrgDefaultProfile>[0];
  name: string;
  orgId: string;
  profileId: string;
}): Promise<string> {
  const skillId = `skill_${input.name}`;
  const sourcePath = join(
    input.configDir,
    "orgs",
    input.orgId,
    "profiles",
    input.profileId,
    "skills",
    input.name
  );
  await mkdir(sourcePath, { recursive: true });
  await writeFile(
    join(sourcePath, "SKILL.md"),
    `---\nname: ${input.name}\ndescription: Test.\n---\n\nKeep this.\n`
  );
  const createdAt = new Date(NOW.getTime() - 100 * DAY_MS).toISOString();
  await input.db.upsertSkill({
    createdAt,
    createdBy: "agent",
    description: "Test.",
    disableModelInvocation: false,
    enabled: true,
    hasTool: false,
    id: skillId,
    name: input.name,
    orgId: input.orgId,
    sourcePath,
    updatedAt: createdAt,
  });
  await input.db.assignSkillToProfile(input.profileId, skillId);
  await input.db.incrementSkillUsage({
    orgId: input.orgId,
    profileId: input.profileId,
    skillId,
    useDelta: 1,
    usedAt: new Date(NOW.getTime() - 95 * DAY_MS).toISOString(),
  });
  return skillId;
}
