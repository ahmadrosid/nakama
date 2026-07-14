import { builtinTools } from "@nakama/core";
import { preinstalledMcpServers } from "@nakama/core/mcp/preinstalled";
import { BUILTIN_TOOL_IDS, SUB_AGENT_TOOL_ID } from "@nakama/core/tools/protected";
import { ensureLocalClientAccess } from "./local-client";
import { ensureOrgSuperBotProfiles } from "./org-profiles";
import type { DatabaseAdapter } from "./types";

const LEGACY_BUILTIN_TOOL_NAMES = new Set(["echo", "log", "delay", "search_workspace"]);
const DEPRECATED_BUILTIN_TOOL_NAMES = new Set([
  "archive_profile_memory",
  "update_profile_memory",
  "save_artifact",
  "create_skill",
]);
const DEPRECATED_SERVER_TOOL_NAMES = new Set(["delegate_coding_task"]);
const SUPPORTED_TOOL_HANDLER_TYPES = new Set(["builtin", "bash", "javascript", "sub_agent"]);

export async function seedDatabase(db: DatabaseAdapter): Promise<void> {
  await removeLegacyBuiltinTools(db);
  await removeDeprecatedBuiltinTools(db);
  await removeDeprecatedServerTools(db);
  await removeUnsupportedTools(db);
  await ensureBuiltinToolDefinitions(db);
  await ensureSubAgentToolDefinition(db);
  await ensurePreinstalledMcpServers(db);
  await ensureLocalClientAccess(db);
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

export async function removeDeprecatedBuiltinTools(db: DatabaseAdapter): Promise<void> {
  const profiles = await db.listProfiles();
  const tools = await db.listTools();

  for (const tool of tools) {
    if (tool.handlerType !== "builtin" || !DEPRECATED_BUILTIN_TOOL_NAMES.has(tool.name)) {
      continue;
    }

    for (const profile of profiles) {
      await db.unassignToolFromProfile(profile.id, tool.id);
    }

    await db.deleteTool(tool.id);
  }
}

export async function removeDeprecatedServerTools(db: DatabaseAdapter): Promise<void> {
  const profiles = await db.listProfiles();
  const tools = await db.listTools();

  for (const tool of tools) {
    if (!DEPRECATED_SERVER_TOOL_NAMES.has(tool.name)) {
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

export async function ensureSubAgentToolDefinition(db: DatabaseAdapter): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.getTool(SUB_AGENT_TOOL_ID);

  await db.upsertTool({
    id: SUB_AGENT_TOOL_ID,
    name: "sub_agent",
    description:
      "Run a focused same-profile sub-agent for delegated research, review, planning, or debugging. Returns a structured result for the parent to summarize. Not for repo coding work — use bash with coding-delegation for that.",
    handlerType: "sub_agent",
    handlerConfig: {},
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

export async function ensurePreinstalledMcpServers(db: DatabaseAdapter): Promise<void> {
  const now = new Date().toISOString();

  for (const server of preinstalledMcpServers) {
    const existing = await db.getMcpServer(server.id);

    await db.upsertMcpServer({
      id: server.id,
      name: server.name,
      transport: server.transport,
      config: server.config,
      enabled: true,
      status: existing?.status ?? "disconnected",
      lastError: existing?.lastError ?? null,
      cachedTools: existing?.cachedTools ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }
}
