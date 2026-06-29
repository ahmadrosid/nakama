import { describe, expect, test } from "bun:test";
import { BASH_TOOL_ID, BUILTIN_TOOL_IDS } from "@tinyclaw/core/tools/protected";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";
import { SUPER_BOT_SYSTEM_PROMPT } from "./constants";
import { ensureBuiltinToolDefinitions } from "./seed";
import {
  ensureOrgSuperBotProfiles,
  seedOrgDefaultProfile,
  seedOrgSuperBotProfile,
} from "./org-profiles";

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

  test("is idempotent for the same org", async () => {
    const db = createInMemoryDatabaseAdapter();
    const first = await seedOrgDefaultProfile(db, "org_a");
    const second = await seedOrgDefaultProfile(db, "org_a");

    expect(second.id).toBe(first.id);
    expect(await db.listProfilesForOrg("org_a")).toHaveLength(1);
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

  test("assigns builtins and bash", async () => {
    const db = createInMemoryDatabaseAdapter();
    await ensureBuiltinToolDefinitions(db);
    const profile = await seedOrgSuperBotProfile(db, "org_a");
    const toolIds = (await db.listToolsForProfile(profile.id)).map((tool) => tool.id);

    for (const toolId of Object.values(BUILTIN_TOOL_IDS)) {
      if (toolId === BUILTIN_TOOL_IDS.create_skill) {
        continue;
      }

      expect(toolIds).toContain(toolId);
    }

    expect(toolIds).toContain(BASH_TOOL_ID);
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
