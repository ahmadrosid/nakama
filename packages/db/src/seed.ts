import { builtinTools } from "@tinyclaw/core";
import { BASH_TOOL_ID, BUILTIN_TOOL_IDS } from "@tinyclaw/core/tools/protected";
import {
  DEFAULT_PROFILE_ID,
  LEGACY_SUPER_BOT_SYSTEM_PROMPTS,
  SUPER_BOT_PROFILE_ID,
  SUPER_BOT_SYSTEM_PROMPT,
} from "./constants";
import type { DatabaseAdapter } from "./types";

const LEGACY_BUILTIN_TOOL_NAMES = new Set(["echo", "log", "delay"]);
const SUPPORTED_TOOL_HANDLER_TYPES = new Set(["builtin", "bash", "javascript"]);

export async function seedDatabase(db: DatabaseAdapter): Promise<void> {
  const existingProfiles = await db.listProfiles();

  if (existingProfiles.length === 0) {
    const now = new Date().toISOString();

    await db.upsertProfile({
      id: SUPER_BOT_PROFILE_ID,
      name: "Super Bot",
      systemPrompt: SUPER_BOT_SYSTEM_PROMPT,
      model: null,
      isSuper: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.upsertProfile({
      id: DEFAULT_PROFILE_ID,
      name: "Default Bot",
      systemPrompt: "You are a helpful personal assistant.",
      model: null,
      isSuper: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  await removeLegacyBuiltinTools(db);
  await removeUnsupportedTools(db);
  await ensureBuiltinTools(db);
  await ensureBashToolForSuperBot(db);
  await ensureSuperBotSystemPrompt(db);
}

export async function removeLegacyBuiltinTools(db: DatabaseAdapter): Promise<void> {
  const profiles = await db.listProfiles();
  const tools = await db.listTools();

  for (const tool of tools) {
    if (tool.handlerType !== "builtin" || !LEGACY_BUILTIN_TOOL_NAMES.has(tool.name)) {
      continue;
    }

    for (const profile of profiles) {
      await db.unassignToolFromProfile(profile.id, tool.id);
    }

    await db.deleteTool(tool.id);
  }
}

export async function removeUnsupportedTools(db: DatabaseAdapter): Promise<void> {
  const profiles = await db.listProfiles();
  const tools = await db.listTools();

  for (const tool of tools) {
    if (SUPPORTED_TOOL_HANDLER_TYPES.has(tool.handlerType)) {
      continue;
    }

    for (const profile of profiles) {
      await db.unassignToolFromProfile(profile.id, tool.id);
    }

    await db.deleteTool(tool.id);
  }
}

export async function ensureBuiltinTools(db: DatabaseAdapter): Promise<void> {
  const now = new Date().toISOString();
  const profiles = await db.listProfiles();
  const profileIds = profiles
    .filter(
      (profile) =>
        profile.id === SUPER_BOT_PROFILE_ID || profile.id === DEFAULT_PROFILE_ID,
    )
    .map((profile) => profile.id);

  for (const tool of builtinTools) {
    const toolId = BUILTIN_TOOL_IDS[tool.name as keyof typeof BUILTIN_TOOL_IDS];

    if (!toolId) {
      continue;
    }

    const existing = await db.getTool(toolId);

    await db.upsertTool({
      id: toolId,
      name: tool.name,
      description: tool.description,
      handlerType: "builtin",
      handlerConfig: { name: tool.name },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    for (const profileId of profileIds) {
      await db.assignToolToProfile(profileId, toolId);
    }
  }
}

export async function ensureBashToolForSuperBot(db: DatabaseAdapter): Promise<void> {
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

  await db.assignToolToProfile(SUPER_BOT_PROFILE_ID, BASH_TOOL_ID);
}

export async function ensureSuperBotSystemPrompt(db: DatabaseAdapter): Promise<void> {
  const profile = await db.getProfile(SUPER_BOT_PROFILE_ID);

  if (!profile) {
    return;
  }

  const currentPrompt = profile.systemPrompt.trim();

  if (
    currentPrompt !== SUPER_BOT_SYSTEM_PROMPT &&
    !currentPrompt.includes("TinyClaw orchestrator") &&
    !LEGACY_SUPER_BOT_SYSTEM_PROMPTS.includes(
      currentPrompt as (typeof LEGACY_SUPER_BOT_SYSTEM_PROMPTS)[number],
    )
  ) {
    return;
  }

  await db.upsertProfile({
    ...profile,
    systemPrompt: SUPER_BOT_SYSTEM_PROMPT,
    updatedAt: new Date().toISOString(),
  });
}
