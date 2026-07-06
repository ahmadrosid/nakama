import { describe, expect, test } from "bun:test";
import {
  BASH_TOOL_ID,
  BUILTIN_TOOL_IDS,
  DELEGATE_CODING_TASK_TOOL_ID,
} from "@nakama/core/tools/protected";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";
import { SUPER_BOT_SYSTEM_PROMPT } from "./constants";
import { ensureBuiltinToolDefinitions } from "./seed";
import {
  ensureOrgSuperBotProfiles,
  ensureBundledSkillsAssigned,
  seedOrgDefaultProfile,
  seedOrgSuperBotProfile,
} from "./org-profiles";

async function upsertSkill(db: ReturnType<typeof createInMemoryDatabaseAdapter>, name: string) {
  const now = new Date().toISOString();

  await db.upsertSkill({
    id: `skill_${name}`,
    name,
    description: `${name} skill`,
    sourcePath: `/tmp/skills/${name}`,
    hasTool: false,
    disableModelInvocation: false,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
}

describe("seedOrgDefaultProfile", () => {
  test("creates one default profile per org", async () => {
    const db = createInMemoryDatabaseAdapter();

    const orgAProfile = await seedOrgDefaultProfile(db, "org_a");
    const orgBProfile = await seedOrgDefaultProfile(db, "org_b");

    expect(orgAProfile.orgId).toBe("org_a");
    expect(orgBProfile.orgId).toBe("org_b");
    expect(orgAProfile.id).not.toBe(orgBProfile.id);
    expect(orgAProfile.isDefault).toBe(true);
    expect(orgBProfile.isDefault).toBe(true);

    const orgAList = await db.listProfilesForOrg("org_a");
    const orgBList = await db.listProfilesForOrg("org_b");

    expect(orgAList).toHaveLength(1);
    expect(orgBList).toHaveLength(1);
    expect(orgAList[0]?.id).toBe(orgAProfile.id);
    expect(orgBList[0]?.id).toBe(orgBProfile.id);
  });

  test("seeds empty systemPrompt so soul stack defines identity", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrgDefaultProfile(db, "org_a");

    expect(profile.systemPrompt).toBe("");
  });

  test("is idempotent for the same org", async () => {
    const db = createInMemoryDatabaseAdapter();
    const first = await seedOrgDefaultProfile(db, "org_a");
    const second = await seedOrgDefaultProfile(db, "org_a");

    expect(second.id).toBe(first.id);
    expect(await db.listProfilesForOrg("org_a")).toHaveLength(1);
  });

  test("assigns default bundled skills but not super bot skills", async () => {
    const db = createInMemoryDatabaseAdapter();
    await upsertSkill(db, "create-automation");
    await upsertSkill(db, "create-profile");

    const profile = await seedOrgDefaultProfile(db, "org_a");
    const skillNames = (await db.listSkillsForProfile(profile.id)).map((skill) => skill.name);

    expect(skillNames).toContain("create-automation");
    expect(skillNames).not.toContain("create-profile");
  });
});

describe("seedOrgSuperBotProfile", () => {
  test("creates one super bot per org", async () => {
    const db = createInMemoryDatabaseAdapter();

    const orgASuperBot = await seedOrgSuperBotProfile(db, "org_a");
    const orgBSuperBot = await seedOrgSuperBotProfile(db, "org_b");

    expect(orgASuperBot.orgId).toBe("org_a");
    expect(orgBSuperBot.orgId).toBe("org_b");
    expect(orgASuperBot.id).not.toBe(orgBSuperBot.id);
    expect(orgASuperBot.isSuper).toBe(true);
    expect(orgASuperBot.isDefault).toBe(false);
    expect(orgASuperBot.name).toBe("Super Bot");
    expect(orgASuperBot.systemPrompt).toBe(SUPER_BOT_SYSTEM_PROMPT);

    const orgAList = await db.listProfilesForOrg("org_a");
    expect(orgAList).toHaveLength(1);
    expect(orgAList[0]?.id).toBe(orgASuperBot.id);
  });

  test("assigns builtins, bash, and delegate coding task", async () => {
    const db = createInMemoryDatabaseAdapter();
    await ensureBuiltinToolDefinitions(db);
    const profile = await seedOrgSuperBotProfile(db, "org_a");
    const toolIds = (await db.listToolsForProfile(profile.id)).map((tool) => tool.id);

    for (const toolId of Object.values(BUILTIN_TOOL_IDS)) {
      expect(toolIds).toContain(toolId);
    }

    expect(toolIds).toContain(BASH_TOOL_ID);
    expect(toolIds).toContain(DELEGATE_CODING_TASK_TOOL_ID);
  });

  test("assigns super bot bundled skills", async () => {
    const db = createInMemoryDatabaseAdapter();
    await upsertSkill(db, "create-automation");
    await upsertSkill(db, "create-profile");
    await upsertSkill(db, "coding-delegation");

    const profile = await seedOrgSuperBotProfile(db, "org_a");
    const skillNames = (await db.listSkillsForProfile(profile.id)).map((skill) => skill.name);

    expect(skillNames).toContain("create-automation");
    expect(skillNames).toContain("create-profile");
    expect(skillNames).toContain("coding-delegation");
  });

  test("is idempotent for the same org", async () => {
    const db = createInMemoryDatabaseAdapter();
    const first = await seedOrgSuperBotProfile(db, "org_a");
    const second = await seedOrgSuperBotProfile(db, "org_a");

    expect(second.id).toBe(first.id);
    expect(await db.listProfilesForOrg("org_a")).toHaveLength(1);
  });

  test("backfills newly added builtins on existing super bot", async () => {
    const db = createInMemoryDatabaseAdapter();
    await ensureBuiltinToolDefinitions(db);

    const profile = await seedOrgSuperBotProfile(db, "org_a");
    await db.unassignToolFromProfile(profile.id, BUILTIN_TOOL_IDS.archive_profile_memory);

    await seedOrgSuperBotProfile(db, "org_a");

    const toolIds = (await db.listToolsForProfile(profile.id)).map((tool) => tool.id);
    expect(toolIds).toContain(BUILTIN_TOOL_IDS.archive_profile_memory);
  });

  test("backfills super bot bundled skills on existing super bot", async () => {
    const db = createInMemoryDatabaseAdapter();

    const profile = await seedOrgSuperBotProfile(db, "org_a");
    await upsertSkill(db, "create-profile");

    await seedOrgSuperBotProfile(db, "org_a");

    const skillNames = (await db.listSkillsForProfile(profile.id)).map((skill) => skill.name);
    expect(skillNames).toContain("create-profile");
  });
});

describe("ensureBundledSkillsAssigned", () => {
  test("does not assign super bot-only skills to ordinary profiles", async () => {
    const db = createInMemoryDatabaseAdapter();
    await upsertSkill(db, "create-automation");
    await upsertSkill(db, "create-profile");

    const profile = await seedOrgDefaultProfile(db, "org_a");

    await ensureBundledSkillsAssigned(db);

    const skillNames = (await db.listSkillsForProfile(profile.id)).map((skill) => skill.name);
    expect(skillNames).toContain("create-automation");
    expect(skillNames).not.toContain("create-profile");
  });
});

describe("ensureOrgSuperBotProfiles", () => {
  test("backfills super bot for existing orgs", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertOrganization({
      id: "org_legacy",
      name: "Legacy Org",
      slug: "legacy-org",
      createdAt: now,
      updatedAt: now,
    });
    await seedOrgDefaultProfile(db, "org_legacy");

    expect((await db.listProfilesForOrg("org_legacy")).some((profile) => profile.isSuper)).toBe(
      false,
    );

    await ensureOrgSuperBotProfiles(db);

    const profiles = await db.listProfilesForOrg("org_legacy");
    expect(profiles).toHaveLength(2);
    expect(profiles.some((profile) => profile.isSuper)).toBe(true);
  });
});
