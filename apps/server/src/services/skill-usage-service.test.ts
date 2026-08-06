import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInMemoryDatabaseAdapter,
  seedOrgDefaultProfile,
  type DatabaseAdapter,
} from "@nakama/db";
import { SkillUsageService } from "./skill-usage-service";

const ORG_ID = "org_test";

describe("SkillUsageService", () => {
  let db: DatabaseAdapter;
  let service: SkillUsageService;
  let profileId: string;
  let skillId: string;

  beforeEach(async () => {
    db = createInMemoryDatabaseAdapter();
    service = new SkillUsageService(db);
    const seeded = await seedOrgDefaultProfile(db, ORG_ID);
    profileId = seeded.id;
    const now = new Date().toISOString();
    skillId = "skill_deploy";
    await db.upsertSkill({
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
    await db.assignSkillToProfile(profileId, skillId);
  });

  afterEach(() => {
    // in-memory adapter has no close hook
  });

  test("recordMatches increments use_count", async () => {
    await service.recordMatches(ORG_ID, profileId, [skillId]);
    await service.recordMatches(ORG_ID, profileId, [skillId]);

    const usage = await db.getSkillUsage(profileId, skillId);
    expect(usage?.useCount).toBe(2);
    expect(usage?.lastUsedAt).not.toBeNull();
  });

  test("recordCatalogViews dedupes within session", async () => {
    const context = { sessionId: "sess_1", seenCatalogSkillIds: new Set<string>() };

    await service.recordCatalogViews(ORG_ID, profileId, [skillId], context);
    await service.recordCatalogViews(ORG_ID, profileId, [skillId], context);

    const usage = await db.getSkillUsage(profileId, skillId);
    expect(usage?.viewCount).toBe(1);
  });

  test("recordPatch increments patch_count", async () => {
    await service.recordPatch(ORG_ID, profileId, skillId);

    const usage = await db.getSkillUsage(profileId, skillId);
    expect(usage?.patchCount).toBe(1);
  });

  test("skips unassigned skills", async () => {
    await service.recordMatches(ORG_ID, profileId, ["skill_missing"]);

    const usage = await db.listSkillUsageForProfile(profileId);
    expect(usage).toHaveLength(0);
  });
});
