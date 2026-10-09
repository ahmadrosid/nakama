import { describe, expect, test } from "bun:test";
import {
  BASH_TOOL_ID,
  BUILTIN_TOOL_IDS,
  GENERATE_IMAGE_TOOL_ID,
} from "@nakama/core/tools/protected";
import { createInMemoryDatabaseAdapter } from "./index";
import {
  ensureBundledSkillsAssigned,
  ensureOrgSuperBotProfiles,
  seedOrgDefaultProfile,
  seedOrgSuperBotProfile,
} from "./org-profiles";
import { ensureBuiltinToolDefinitions } from "./seed";

async function upsertSkill(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>,
  name: string
) {
  const now = new Date().toISOString();

  await db.upsertSkill({
    createdAt: now,
    createdBy: "bundled",
    description: `${name} skill`,
    disableModelInvocation: false,
    enabled: true,
    hasTool: false,
    id: `skill_${name}`,
    name,
    sourcePath: `/tmp/skills/${name}`,
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
    await upsertSkill(db, "skill-installer");
    await upsertSkill(db, "update-profile-memory");
    await upsertSkill(db, "archive-profile-memory");
    await upsertSkill(db, "save-artifact");
    await upsertSkill(db, "create-profile");

    const profile = await seedOrgDefaultProfile(db, "org_a");

    const skillNames = (await db.listSkillsForProfile(profile.id)).map(
      (skill) => skill.name
    );

    expect(skillNames).toContain("create-automation");
    expect(skillNames).toContain("skill-installer");
    expect(skillNames).toContain("update-profile-memory");
    expect(skillNames).toContain("archive-profile-memory");
    expect(skillNames).toContain("save-artifact");
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

    const orgAList = await db.listProfilesForOrg("org_a");
    expect(orgAList).toHaveLength(1);
    expect(orgAList[0]?.id).toBe(orgASuperBot.id);
  });

  test("assigns builtins and bash", async () => {
    const db = createInMemoryDatabaseAdapter();
    await ensureBuiltinToolDefinitions(db);
    const profile = await seedOrgSuperBotProfile(db, "org_a");

    const toolIds = (await db.listToolsForProfile(profile.id)).map(
      (tool) => tool.id
    );

    for (const toolId of Object.values(BUILTIN_TOOL_IDS)) {
      if (
        toolId !== BUILTIN_TOOL_IDS.delete_file &&
        toolId !== BUILTIN_TOOL_IDS.email
      ) {
        expect(toolIds).toContain(toolId);
      }
    }

    expect(toolIds).toContain(BASH_TOOL_ID);
    expect(toolIds).not.toContain(BUILTIN_TOOL_IDS.delete_file);
    expect(toolIds).not.toContain(GENERATE_IMAGE_TOOL_ID);
  });

  test("the shared mailbox tool is never assigned by default, on create or on a later boot", async () => {
    const db = createInMemoryDatabaseAdapter();
    await ensureBuiltinToolDefinitions(db);
    const superBot = await seedOrgSuperBotProfile(db, "org_a");
    const defaultBot = await seedOrgDefaultProfile(db, "org_a");

    const toolIdsOf = async (profileId: string) =>
      (await db.listToolsForProfile(profileId)).map((tool) => tool.id);

    expect(await toolIdsOf(superBot.id)).not.toContain(BUILTIN_TOOL_IDS.email);
    expect(await toolIdsOf(defaultBot.id)).not.toContain(
      BUILTIN_TOOL_IDS.email
    );

    // An admin's explicit choice survives the seed that runs on every boot.
    await db.assignToolToProfile(defaultBot.id, BUILTIN_TOOL_IDS.email);
    await seedOrgSuperBotProfile(db, "org_a");
    await seedOrgDefaultProfile(db, "org_a");

    expect(await toolIdsOf(superBot.id)).not.toContain(BUILTIN_TOOL_IDS.email);
    expect(await toolIdsOf(defaultBot.id)).toContain(BUILTIN_TOOL_IDS.email);
  });

  test("unassigns delete_file from an existing super bot", async () => {
    const db = createInMemoryDatabaseAdapter();
    await ensureBuiltinToolDefinitions(db);
    const profile = await seedOrgSuperBotProfile(db, "org_a");

    await db.assignToolToProfile(profile.id, BUILTIN_TOOL_IDS.delete_file);
    expect(
      (await db.listToolsForProfile(profile.id)).map((tool) => tool.id)
    ).toContain(BUILTIN_TOOL_IDS.delete_file);

    await seedOrgSuperBotProfile(db, "org_a");

    expect(
      (await db.listToolsForProfile(profile.id)).map((tool) => tool.id)
    ).not.toContain(BUILTIN_TOOL_IDS.delete_file);
  });

  test("assigns super bot bundled skills", async () => {
    const db = createInMemoryDatabaseAdapter();
    await upsertSkill(db, "create-automation");
    await upsertSkill(db, "create-profile");
    await upsertSkill(db, "coding-agent");
    await upsertSkill(db, "agent-browser");

    const profile = await seedOrgSuperBotProfile(db, "org_a");

    const skillNames = (await db.listSkillsForProfile(profile.id)).map(
      (skill) => skill.name
    );

    expect(skillNames).toContain("create-automation");
    expect(skillNames).toContain("create-profile");
    expect(skillNames).toContain("coding-agent");
    expect(skillNames).not.toContain("agent-browser");
  });

  test("is idempotent for the same org", async () => {
    const db = createInMemoryDatabaseAdapter();
    const first = await seedOrgSuperBotProfile(db, "org_a");
    const second = await seedOrgSuperBotProfile(db, "org_a");

    expect(second.id).toBe(first.id);
    expect(await db.listProfilesForOrg("org_a")).toHaveLength(1);
  });

  test("backfills newly added bundled skills on existing super bot", async () => {
    const db = createInMemoryDatabaseAdapter();

    const profile = await seedOrgSuperBotProfile(db, "org_a");
    await upsertSkill(db, "update-profile-memory");
    await upsertSkill(db, "archive-profile-memory");
    await upsertSkill(db, "save-artifact");

    await seedOrgSuperBotProfile(db, "org_a");

    const skillNames = (await db.listSkillsForProfile(profile.id)).map(
      (skill) => skill.name
    );

    expect(skillNames).toContain("update-profile-memory");
    expect(skillNames).toContain("archive-profile-memory");
    expect(skillNames).toContain("save-artifact");
  });

  test("backfills super bot bundled skills on existing super bot", async () => {
    const db = createInMemoryDatabaseAdapter();

    const profile = await seedOrgSuperBotProfile(db, "org_a");
    await upsertSkill(db, "create-profile");

    await seedOrgSuperBotProfile(db, "org_a");

    const skillNames = (await db.listSkillsForProfile(profile.id)).map(
      (skill) => skill.name
    );

    expect(skillNames).toContain("create-profile");
  });
});

describe("ensureBundledSkillsAssigned", () => {
  test("does not assign super bot-only skills to ordinary profiles", async () => {
    const db = createInMemoryDatabaseAdapter();
    await upsertSkill(db, "create-automation");
    await upsertSkill(db, "create-profile");
    await upsertSkill(db, "agent-browser");

    const profile = await seedOrgDefaultProfile(db, "org_a");

    await ensureBundledSkillsAssigned(db);

    const skillNames = (await db.listSkillsForProfile(profile.id)).map(
      (skill) => skill.name
    );

    expect(skillNames).toContain("create-automation");
    expect(skillNames).not.toContain("create-profile");
    expect(skillNames).not.toContain("agent-browser");
  });
});

describe("ensureOrgSuperBotProfiles", () => {
  test("backfills super bot for existing orgs", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertOrganization({
      createdAt: now,
      id: "org_legacy",
      name: "Legacy Org",
      slug: "legacy-org",
      updatedAt: now,
    });
    await seedOrgDefaultProfile(db, "org_legacy");

    expect(
      (await db.listProfilesForOrg("org_legacy")).some(
        (profile) => profile.isSuper
      )
    ).toBe(false);

    await ensureOrgSuperBotProfiles(db);

    const profiles = await db.listProfilesForOrg("org_legacy");
    expect(profiles).toHaveLength(2);
    expect(profiles.some((profile) => profile.isSuper)).toBe(true);
  });
});

test("shared listing is seeded and assigned to fresh profiles, without restoring upgrade removals", async () => {
  const db = createInMemoryDatabaseAdapter();
  await ensureBuiltinToolDefinitions(db);
  expect((await db.getTool(BUILTIN_TOOL_IDS.list_artifacts))?.handlerType).toBe(
    "builtin"
  );

  for (const seed of [seedOrgDefaultProfile, seedOrgSuperBotProfile]) {
    const profile = await seed(db, "org_listing");
    expect(
      (await db.listToolsForProfile(profile.id)).some(
        (tool) => tool.name === "list_artifacts"
      )
    ).toBe(true);
    await db.unassignToolFromProfile(
      profile.id,
      BUILTIN_TOOL_IDS.list_artifacts
    );
    await seed(db, "org_listing");
    expect(
      (await db.listToolsForProfile(profile.id)).some(
        (tool) => tool.name === "list_artifacts"
      )
    ).toBe(false);
    await db.assignToolToProfile(profile.id, BUILTIN_TOOL_IDS.list_artifacts);
    await seed(db, "org_listing");
    expect(
      (await db.listToolsForProfile(profile.id)).some(
        (tool) => tool.name === "list_artifacts"
      )
    ).toBe(true);
  }
});

describe("profile ACP agent", () => {
  test("keeps the ACP agent command across a save and read", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertProfile({
      acpAgent: {
        args: ["-y", "@agentclientprotocol/claude-agent-acp@0.88.0"],
        command: "npx",
      },
      createdAt: now,
      id: "profile_acp",
      isSuper: false,
      model: null,
      name: "ACP",
      orgId: "org_a",
      systemPrompt: "",
      updatedAt: now,
    });

    const saved = await db.getProfileForOrg("profile_acp", "org_a");
    expect(saved?.acpAgent).toEqual({
      args: ["-y", "@agentclientprotocol/claude-agent-acp@0.88.0"],
      command: "npx",
    });
  });

  test("reads a profile without an ACP agent as null", async () => {
    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();

    await db.upsertProfile({
      createdAt: now,
      id: "profile_plain",
      isSuper: false,
      model: null,
      name: "Plain",
      orgId: "org_a",
      systemPrompt: "",
      updatedAt: now,
    });

    const saved = await db.getProfileForOrg("profile_plain", "org_a");
    expect(saved?.acpAgent).toBeNull();
  });
});
