import {
  DEFAULT_BUNDLED_SKILL_NAMES,
  nanoid,
  SUPER_BOT_BUNDLED_SKILL_NAMES,
} from "@nakama/core";
import {
  BASH_TOOL_ID,
  BUILTIN_TOOL_IDS,
  GENERATE_IMAGE_TOOL_ID,
  LIST_PROFILE_SESSIONS_TOOL_ID,
  READ_PROFILE_SESSION_TOOL_ID,
} from "@nakama/core/tools/protected";
import { SUPER_BOT_SYSTEM_PROMPT } from "./constants";
import type { DatabaseAdapter, StoredProfileRecord } from "./types";

const DEFAULT_BUILTIN_TOOL_IDS = Object.values(BUILTIN_TOOL_IDS);
const SUPER_BOT_BUILTIN_TOOL_IDS = DEFAULT_BUILTIN_TOOL_IDS.filter(
  (toolId) => toolId !== BUILTIN_TOOL_IDS.delete_file
);

export async function ensureProfileDefaultBuiltinTools(
  db: DatabaseAdapter,
  profileId: string
): Promise<void> {
  for (const toolId of DEFAULT_BUILTIN_TOOL_IDS) {
    await db.assignToolToProfile(profileId, toolId);
  }
}

export async function ensureProfileSuperBotBuiltinTools(
  db: DatabaseAdapter,
  profileId: string
): Promise<void> {
  for (const toolId of SUPER_BOT_BUILTIN_TOOL_IDS) {
    await db.assignToolToProfile(profileId, toolId);
  }

  await db.unassignToolFromProfile(profileId, BUILTIN_TOOL_IDS.delete_file);
}

export async function ensureProfileDefaultBundledSkills(
  db: DatabaseAdapter,
  profileId: string
): Promise<void> {
  for (const name of DEFAULT_BUNDLED_SKILL_NAMES) {
    const skill = await db.getSkillByName(name);

    if (skill) {
      await db.assignSkillToProfile(profileId, skill.id);
    }
  }
}

export async function ensureProfileSuperBotBundledSkills(
  db: DatabaseAdapter,
  profileId: string
): Promise<void> {
  for (const name of SUPER_BOT_BUNDLED_SKILL_NAMES) {
    const skill = await db.getSkillByName(name);

    if (skill) {
      await db.assignSkillToProfile(profileId, skill.id);
    }
  }
}

export async function ensureBundledSkillsAssigned(
  db: DatabaseAdapter
): Promise<void> {
  const profiles = await db.listProfiles();

  for (const profile of profiles) {
    await ensureProfileDefaultBundledSkills(db, profile.id);
  }
}

export async function seedOrgDefaultProfile(
  db: DatabaseAdapter,
  orgId: string
): Promise<StoredProfileRecord> {
  const existing = await db.getDefaultProfileForOrg(orgId);

  if (existing) {
    await ensureProfileDefaultBuiltinTools(db, existing.id);
    await ensureProfileDefaultBundledSkills(db, existing.id);
    return existing;
  }

  const now = new Date().toISOString();
  const profile: StoredProfileRecord = {
    createdAt: now,
    id: nanoid(),
    isDefault: true,
    isSuper: false,
    model: null,
    name: "Default Bot",
    orgId,
    systemPrompt: "",
    updatedAt: now,
  };

  await db.upsertProfile(profile);

  for (const toolId of DEFAULT_BUILTIN_TOOL_IDS) {
    await db.assignToolToProfile(profile.id, toolId);
  }

  await ensureProfileDefaultBundledSkills(db, profile.id);

  return profile;
}

export async function seedOrgSuperBotProfile(
  db: DatabaseAdapter,
  orgId: string
): Promise<StoredProfileRecord> {
  const existing = (await db.listProfilesForOrg(orgId)).find(
    (profile) => profile.isSuper
  );

  if (existing) {
    await ensureProfileSuperBotBuiltinTools(db, existing.id);
    await ensureProfileDefaultBundledSkills(db, existing.id);
    await ensureProfileSuperBotBundledSkills(db, existing.id);
    await ensureSuperBotBashTool(db, existing.id);
    await ensureSuperBotSessionTools(db, existing.id);
    return existing;
  }

  const now = new Date().toISOString();
  const profile: StoredProfileRecord = {
    createdAt: now,
    id: nanoid(),
    isDefault: false,
    isSuper: true,
    model: null,
    name: "Super Bot",
    orgId,
    systemPrompt: SUPER_BOT_SYSTEM_PROMPT,
    updatedAt: now,
  };

  await db.upsertProfile(profile);

  await ensureProfileSuperBotBuiltinTools(db, profile.id);
  await ensureSuperBotBashTool(db, profile.id);
  await ensureSuperBotSessionTools(db, profile.id);
  await ensureProfileDefaultBundledSkills(db, profile.id);
  await ensureProfileSuperBotBundledSkills(db, profile.id);

  return profile;
}

export async function ensureOrgSuperBotProfiles(
  db: DatabaseAdapter
): Promise<void> {
  const orgs = await db.listOrganizations();

  for (const org of orgs) {
    await seedOrgSuperBotProfile(db, org.id);
  }
}

export async function ensureBashToolDefinition(
  db: DatabaseAdapter
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.getTool(BASH_TOOL_ID);

  await db.upsertTool({
    createdAt: existing?.createdAt ?? now,
    description:
      "Run a shell command in the profile workspace and return stdout, stderr, and exit code.",
    handlerConfig: {},
    handlerType: "bash",
    id: BASH_TOOL_ID,
    name: "bash",
    updatedAt: now,
  });
}

export async function ensureGenerateImageToolDefinition(
  db: DatabaseAdapter
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.getTool(GENERATE_IMAGE_TOOL_ID);

  await db.upsertTool({
    createdAt: existing?.createdAt ?? now,
    description:
      "Generate an image from a text prompt using the workspace image model (OpenAI gpt-image-2). Saves under artifacts/ with a metadata sidecar.",
    handlerConfig: {},
    handlerType: "generate_image",
    id: GENERATE_IMAGE_TOOL_ID,
    name: "generate_image",
    updatedAt: now,
  });
}

/**
 * Session reader tools. Seeded so they exist and survive removeUnsupportedTools,
 * but not assigned to any profile here: like sub_agent, they are opt-in per
 * profile through the normal tool assignment path.
 */
export async function ensureSessionToolDefinitions(
  db: DatabaseAdapter
): Promise<void> {
  const now = new Date().toISOString();
  const definitions = [
    {
      description:
        "List the chat sessions of another agent profile in this organization, newest activity first. Use it to find a session id before reading its transcript.",
      id: LIST_PROFILE_SESSIONS_TOOL_ID,
      name: "list_profile_sessions",
    },
    {
      description:
        "Read the stored transcript of a session belonging to another agent profile in this organization.",
      id: READ_PROFILE_SESSION_TOOL_ID,
      name: "read_profile_session",
    },
  ];

  for (const definition of definitions) {
    const existing = await db.getTool(definition.id);

    await db.upsertTool({
      createdAt: existing?.createdAt ?? now,
      description: definition.description,
      handlerConfig: {},
      handlerType: "session",
      id: definition.id,
      name: definition.name,
      updatedAt: now,
    });
  }
}

export async function ensureSuperBotSessionTools(
  db: DatabaseAdapter,
  profileId: string
): Promise<void> {
  await ensureSessionToolDefinitions(db);
  await db.assignToolToProfile(profileId, LIST_PROFILE_SESSIONS_TOOL_ID);
  await db.assignToolToProfile(profileId, READ_PROFILE_SESSION_TOOL_ID);
}

export async function ensureSuperBotBashTool(
  db: DatabaseAdapter,
  profileId: string
): Promise<void> {
  await ensureBashToolDefinition(db);
  await db.assignToolToProfile(profileId, BASH_TOOL_ID);
}
