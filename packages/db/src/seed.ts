import { builtinTools } from "@tinyclaw/core";
import { BUILTIN_TOOL_IDS } from "@tinyclaw/core/tools/protected";
import { ensureOrgSuperBotProfiles } from "./org-profiles";
import type { DatabaseAdapter } from "./types";

const LEGACY_BUILTIN_TOOL_NAMES = new Set(["echo", "log", "delay", "search_workspace"]);
const SUPPORTED_TOOL_HANDLER_TYPES = new Set(["builtin", "bash", "javascript"]);

export async function seedDatabase(db: DatabaseAdapter): Promise<void> {
  await removeLegacyBuiltinTools(db);
  await removeUnsupportedTools(db);
  await ensureBuiltinToolDefinitions(db);
  await ensureOrgSuperBotProfiles(db);
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

export async function ensureBuiltinToolDefinitions(db: DatabaseAdapter): Promise<void> {
  const now = new Date().toISOString();

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
  }
}
