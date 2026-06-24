import { nanoid } from "@tinyclaw/core";
import { BASH_TOOL_ID, BUILTIN_TOOL_IDS } from "@tinyclaw/core/tools/protected";
import { SUPER_BOT_SYSTEM_PROMPT } from "./constants";
import type { DatabaseAdapter, StoredProfileRecord } from "./types";

const DEFAULT_BUILTIN_TOOL_IDS = Object.values(BUILTIN_TOOL_IDS).filter(
  (toolId) => toolId !== BUILTIN_TOOL_IDS.create_skill,
);

export async function seedOrgDefaultProfile(
  db: DatabaseAdapter,
  orgId: string,
): Promise<StoredProfileRecord> {
  const existing = await db.getDefaultProfileForOrg(orgId);

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const profile: StoredProfileRecord = {
    id: nanoid(),
    name: "Default Bot",
    systemPrompt: "You are a helpful personal assistant.",
    model: null,
    isSuper: false,
    orgId,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };

  await db.upsertProfile(profile);

  for (const toolId of DEFAULT_BUILTIN_TOOL_IDS) {
    await db.assignToolToProfile(profile.id, toolId);
  }

  return profile;
}

export async function seedOrgSuperBotProfile(
  db: DatabaseAdapter,
  orgId: string,
): Promise<StoredProfileRecord> {
  const existing = (await db.listProfilesForOrg(orgId)).find((profile) => profile.isSuper);

  if (existing) {
    await ensureSuperBotBashTool(db, existing.id);
    return existing;
  }

  const now = new Date().toISOString();
  const profile: StoredProfileRecord = {
    id: nanoid(),
    name: "Super Bot",
    systemPrompt: SUPER_BOT_SYSTEM_PROMPT,
    model: null,
    isSuper: true,
    orgId,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };

  await db.upsertProfile(profile);

  for (const toolId of DEFAULT_BUILTIN_TOOL_IDS) {
    await db.assignToolToProfile(profile.id, toolId);
  }

  await ensureSuperBotBashTool(db, profile.id);

  return profile;
}

export async function ensureOrgSuperBotProfiles(db: DatabaseAdapter): Promise<void> {
  const orgs = await db.listOrganizations();

  for (const org of orgs) {
    await seedOrgSuperBotProfile(db, org.id);
  }
}

export async function ensureSuperBotBashTool(db: DatabaseAdapter, profileId: string): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.getTool(BASH_TOOL_ID);

  await db.upsertTool({
    id: BASH_TOOL_ID,
    name: "bash",
    description:
      "Run a shell command and return stdout, stderr, and exit code. Super Bot only.",
    handlerType: "bash",
    handlerConfig: {},
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  await db.assignToolToProfile(profileId, BASH_TOOL_ID);
}
