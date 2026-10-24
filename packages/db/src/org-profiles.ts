import {
  DEFAULT_BUNDLED_SKILL_NAMES,
  nanoid,
  SUPER_NAKAMA_BUNDLED_SKILL_NAMES,
} from "@nakama/core";
import {
  BASH_TOOL_ID,
  BROWSER_TOOL_IDS,
  BUILTIN_TOOL_IDS,
  GENERATE_IMAGE_TOOL_ID,
  LIST_PROFILE_SESSIONS_TOOL_ID,
  READ_PROFILE_SESSION_TOOL_ID,
  SAVE_ARTIFACT_TOOL_ID,
} from "@nakama/core/tools/protected";
import { SUPER_NAKAMA_SYSTEM_PROMPT } from "./constants";
import type { DatabaseAdapter, StoredProfileRecord } from "./types";

// The mailbox is one config for the whole install, so email is opt-in. This
// list is re-applied on every boot and would hand it back after an unassign.
const DEFAULT_BUILTIN_TOOL_IDS = Object.values(BUILTIN_TOOL_IDS).filter(
  (toolId) => toolId !== BUILTIN_TOOL_IDS.email
);

export async function ensureProfileDefaultBuiltinTools(
  db: DatabaseAdapter,
  profileId: string,
  existingProfile = false
): Promise<void> {
  for (const toolId of DEFAULT_BUILTIN_TOOL_IDS) {
    if (existingProfile && toolId === BUILTIN_TOOL_IDS.list_artifacts) {
      continue;
    }

    await db.assignToolToProfile(profileId, toolId);
  }

  if (await db.getTool(SAVE_ARTIFACT_TOOL_ID)) {
    await db.assignToolToProfile(profileId, SAVE_ARTIFACT_TOOL_ID);
  }
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

export async function ensureProfileSuperNakamaBundledSkills(
  db: DatabaseAdapter,
  profileId: string
): Promise<void> {
  for (const name of SUPER_NAKAMA_BUNDLED_SKILL_NAMES) {
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

  // Only an org known to be archived is skipped: a profile whose org row is
  // missing still gets its skills, as it did before.
  const archivedOrgIds = new Set(
    (await db.listOrganizations())
      .filter((org) => org.archivedAt)
      .map((org) => org.id)
  );

  for (const profile of profiles) {
    if (profile.orgId && archivedOrgIds.has(profile.orgId)) {
      continue;
    }

    await ensureProfileDefaultBundledSkills(db, profile.id);

    // Boot seeds Super Nakamas before skill rows sync, so a new skill lands here.
    if (profile.isSuper) {
      await ensureProfileSuperNakamaBundledSkills(db, profile.id);
    }
  }
}

export async function seedOrgDefaultProfile(
  db: DatabaseAdapter,
  orgId: string
): Promise<StoredProfileRecord> {
  const existing = await db.getDefaultProfileForOrg(orgId);

  if (existing) {
    await ensureProfileDefaultBuiltinTools(db, existing.id, true);
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
  await ensureProfileDefaultBuiltinTools(db, profile.id);
  await ensureProfileDefaultBundledSkills(db, profile.id);

  return profile;
}

export async function seedOrgSuperNakamaProfile(
  db: DatabaseAdapter,
  orgId: string,
  options: SuperNakamaSeedOptions = {}
): Promise<StoredProfileRecord> {
  const existing = (await db.listProfilesForOrg(orgId)).find(
    (profile) => profile.isSuper
  );

  const now = new Date().toISOString();

  const profile: StoredProfileRecord = existing ?? {
    createdAt: now,
    id: nanoid(),
    isDefault: false,
    isSuper: true,
    model: null,
    name: "Super Nakama",
    orgId,
    systemPrompt: SUPER_NAKAMA_SYSTEM_PROMPT,
    updatedAt: now,
  };

  if (!existing) {
    await db.upsertProfile(profile);
  }

  await ensureProfileDefaultBuiltinTools(db, profile.id, !!existing);
  await db.unassignToolFromProfile(profile.id, BUILTIN_TOOL_IDS.delete_file);
  await ensureSuperNakamaBashTool(db, profile.id, options.grantBash);
  await ensureSuperNakamaSessionTools(db, profile.id);
  await ensureProfileDefaultBundledSkills(db, profile.id);
  await ensureProfileSuperNakamaBundledSkills(db, profile.id);

  return profile;
}

export async function ensureOrgSuperNakamaProfiles(
  db: DatabaseAdapter,
  options: SuperNakamaSeedOptions = {}
): Promise<void> {
  const orgs = await db.listOrganizations();

  for (const org of orgs) {
    if (org.archivedAt) {
      continue;
    }

    await seedOrgSuperNakamaProfile(db, org.id, options);
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

export async function ensureSaveArtifactToolDefinition(
  db: DatabaseAdapter
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.getTool(SAVE_ARTIFACT_TOOL_ID);

  await db.upsertTool({
    createdAt: existing?.createdAt ?? now,
    description:
      "Save a text deliverable under artifacts/ and record which user made it.",
    handlerConfig: {},
    handlerType: "save_artifact",
    id: SAVE_ARTIFACT_TOOL_ID,
    name: "save_artifact",
    updatedAt: now,
  });

  if (existing) {
    return;
  }

  // Once, when the tool first appears: every profile that can write files can save
  // artifacts. Later boots skip this, so an admin can unassign it.
  for (const profile of await db.listProfiles()) {
    const tools = await db.listToolsForProfile(profile.id);

    if (tools.some((tool) => tool.id === BUILTIN_TOOL_IDS.write_file)) {
      await db.assignToolToProfile(profile.id, SAVE_ARTIFACT_TOOL_ID);
    }
  }
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

/**
 * Kernel cloud browser tools. Seeded so they exist and survive
 * removeUnsupportedTools, and opt-in per profile like the session tools. They
 * only work once a platform admin sets up the Kernel browser runtime.
 */
export async function ensureBrowserToolDefinitions(
  db: DatabaseAdapter
): Promise<void> {
  const now = new Date().toISOString();

  const definitions = [
    {
      description: "Open a URL in the user's cloud browser.",
      id: BROWSER_TOOL_IDS.browser_navigate,
      name: "browser_navigate",
    },
    {
      description: "Read the text and links of the current page.",
      id: BROWSER_TOOL_IDS.browser_read,
      name: "browser_read",
    },
    {
      description: "Scroll the page and wait for new content.",
      id: BROWSER_TOOL_IDS.browser_scroll,
      name: "browser_scroll",
    },
    {
      description: "Run Playwright code in the user's cloud browser.",
      id: BROWSER_TOOL_IDS.browser_playwright,
      name: "browser_playwright",
    },
    {
      description: "Take a screenshot of the user's cloud browser.",
      id: BROWSER_TOOL_IDS.browser_screenshot,
      name: "browser_screenshot",
    },
    {
      description: "Use the mouse and keyboard on the user's cloud browser.",
      id: BROWSER_TOOL_IDS.browser_computer,
      name: "browser_computer",
    },
  ];

  for (const definition of definitions) {
    const existing = await db.getTool(definition.id);

    await db.upsertTool({
      createdAt: existing?.createdAt ?? now,
      description: definition.description,
      handlerConfig: {},
      handlerType: "browser",
      id: definition.id,
      name: definition.name,
      updatedAt: now,
    });
  }
}

export async function ensureSuperNakamaSessionTools(
  db: DatabaseAdapter,
  profileId: string
): Promise<void> {
  await ensureSessionToolDefinitions(db);
  await db.assignToolToProfile(profileId, LIST_PROFILE_SESSIONS_TOOL_ID);
  await db.assignToolToProfile(profileId, READ_PROFILE_SESSION_TOOL_ID);
}

export interface SuperNakamaSeedOptions {
  /** False when the deployment turned bash off (NAKAMA_TENANT_BASH=0). */
  grantBash?: boolean;
}

export async function ensureSuperNakamaBashTool(
  db: DatabaseAdapter,
  profileId: string,
  grantBash = true
): Promise<void> {
  await ensureBashToolDefinition(db);

  if (grantBash) {
    await db.assignToolToProfile(profileId, BASH_TOOL_ID);
  } else {
    await db.unassignToolFromProfile(profileId, BASH_TOOL_ID);
  }
}
