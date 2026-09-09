import {
  builtinTools,
  type McpHttpConfig,
  type McpStdioConfig,
} from "@nakama/core";
import { preinstalledMcpServers } from "@nakama/core/mcp/preinstalled";
import {
  BUILTIN_TOOL_IDS,
  SUB_AGENT_TOOL_ID,
} from "@nakama/core/tools/protected";
import { ensureLocalClientAccess } from "./local-client";
import {
  ensureBashToolDefinition,
  ensureGenerateImageToolDefinition,
  ensureOrgSuperBotProfiles,
  ensureSessionToolDefinitions,
} from "./org-profiles";
import type { DatabaseAdapter } from "./types";

const LEGACY_BUILTIN_TOOL_NAMES = new Set([
  "echo",
  "log",
  "delay",
  "search_workspace",
]);
const DEPRECATED_BUILTIN_TOOL_NAMES = new Set([
  "archive_profile_memory",
  "update_profile_memory",
  "save_artifact",
  "create_skill",
]);
const DEPRECATED_SERVER_TOOL_NAMES = new Set(["delegate_coding_task"]);
const SUPPORTED_TOOL_HANDLER_TYPES = new Set([
  "builtin",
  "bash",
  "javascript",
  "python",
  "sub_agent",
  "generate_image",
  "session",
]);

export async function seedDatabase(db: DatabaseAdapter): Promise<void> {
  await removeLegacyBuiltinTools(db);
  await removeDeprecatedBuiltinTools(db);
  await removeDeprecatedServerTools(db);
  await removeUnsupportedTools(db);
  await ensureBuiltinToolDefinitions(db);
  await ensureSubAgentToolDefinition(db);
  await ensureSessionToolDefinitions(db);
  await ensureBashToolDefinition(db);
  await ensureGenerateImageToolDefinition(db);
  await ensurePreinstalledMcpServers(db);
  await ensureLocalClientAccess(db);
  await ensureOrgSuperBotProfiles(db);
}

async function removeToolsMatching(
  db: DatabaseAdapter,
  shouldRemove: (tool: { handlerType: string; name: string }) => boolean
): Promise<void> {
  const tools = await db.listTools();

  for (const tool of tools) {
    if (!shouldRemove(tool)) {
      continue;
    }

    // deleteTool unassigns every profile + deletes in one SQLite transaction.
    await db.deleteTool(tool.id);
  }
}

export async function removeLegacyBuiltinTools(
  db: DatabaseAdapter
): Promise<void> {
  await removeToolsMatching(
    db,
    (tool) =>
      tool.handlerType === "builtin" && LEGACY_BUILTIN_TOOL_NAMES.has(tool.name)
  );
}

export async function removeDeprecatedBuiltinTools(
  db: DatabaseAdapter
): Promise<void> {
  await removeToolsMatching(
    db,
    (tool) =>
      tool.handlerType === "builtin" &&
      DEPRECATED_BUILTIN_TOOL_NAMES.has(tool.name)
  );
}

export async function removeDeprecatedServerTools(
  db: DatabaseAdapter
): Promise<void> {
  await removeToolsMatching(db, (tool) =>
    DEPRECATED_SERVER_TOOL_NAMES.has(tool.name)
  );
}

export async function removeUnsupportedTools(
  db: DatabaseAdapter
): Promise<void> {
  await removeToolsMatching(
    db,
    (tool) => !SUPPORTED_TOOL_HANDLER_TYPES.has(tool.handlerType)
  );
}

export async function ensureBuiltinToolDefinitions(
  db: DatabaseAdapter
): Promise<void> {
  const now = new Date().toISOString();

  for (const tool of builtinTools) {
    const toolId = BUILTIN_TOOL_IDS[tool.name as keyof typeof BUILTIN_TOOL_IDS];

    if (!toolId) {
      continue;
    }

    const existing = await db.getTool(toolId);

    await db.upsertTool({
      createdAt: existing?.createdAt ?? now,
      description: tool.description,
      handlerConfig: { name: tool.name },
      handlerType: "builtin",
      id: toolId,
      name: tool.name,
      updatedAt: now,
    });
  }
}

export async function ensureSubAgentToolDefinition(
  db: DatabaseAdapter
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.getTool(SUB_AGENT_TOOL_ID);

  await db.upsertTool({
    createdAt: existing?.createdAt ?? now,
    description:
      "Run a focused same-profile sub-agent for delegated research, review, planning, or debugging. Returns a structured result for the parent to summarize. Not for repo coding work — use bash with coding-agent for that.",
    handlerConfig: {},
    handlerType: "sub_agent",
    id: SUB_AGENT_TOOL_ID,
    name: "sub_agent",
    updatedAt: now,
  });
}

const FIRECRAWL_LEGACY_KEY_URL =
  /^https:\/\/mcp\.firecrawl\.dev\/([^/]+)\/v2\/mcp\/?$/i;

export async function ensurePreinstalledMcpServers(
  db: DatabaseAdapter
): Promise<void> {
  const now = new Date().toISOString();

  for (const server of preinstalledMcpServers) {
    const existing = await db.getMcpServer(server.id);

    if (!existing) {
      const nameOwner = await db.getMcpServerByName(server.name);

      if (nameOwner && nameOwner.id !== server.id) {
        console.warn(
          `Preinstalled MCP server "${server.name}" was not inserted: name already used by ${nameOwner.id}.`
        );
        continue;
      }
    }

    await db.upsertMcpServer({
      cachedTools: existing?.cachedTools ?? [],
      config: existing
        ? mergePreinstalledHttpConfig(server.config, existing.config)
        : server.config,
      createdAt: existing?.createdAt ?? now,
      enabled: existing?.enabled ?? true,
      id: server.id,
      lastError: existing?.lastError ?? null,
      name: server.name,
      status: existing?.status ?? "disconnected",
      transport: server.transport,
      updatedAt: now,
    });
  }
}

function mergePreinstalledHttpConfig(
  catalogConfig: McpHttpConfig | McpStdioConfig,
  existingConfig: unknown
): McpHttpConfig | McpStdioConfig {
  if (!("url" in catalogConfig)) {
    return catalogConfig;
  }

  const headers = { ...readHttpHeaders(existingConfig) };
  const legacyBearer = firecrawlLegacyBearer(readHttpUrl(existingConfig));

  if (legacyBearer && !headers.Authorization) {
    headers.Authorization = legacyBearer;
  }

  if (Object.keys(headers).length === 0) {
    return { url: catalogConfig.url };
  }

  return { headers, url: catalogConfig.url };
}

function readHttpUrl(config: unknown): string | undefined {
  if (typeof config !== "object" || config === null) {
    return;
  }

  const url = (config as Record<string, unknown>).url;

  return typeof url === "string" && url.trim() ? url.trim() : undefined;
}

function readHttpHeaders(config: unknown): Record<string, string> {
  if (typeof config !== "object" || config === null) {
    return {};
  }

  const headers = (config as Record<string, unknown>).headers;

  if (typeof headers !== "object" || headers === null) {
    return {};
  }

  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string" && value.trim()) {
      result[key] = value;
    }
  }

  return result;
}

function firecrawlLegacyBearer(url: string | undefined): string | undefined {
  if (!url) {
    return;
  }

  const token = FIRECRAWL_LEGACY_KEY_URL.exec(url)?.[1]?.trim();

  return token ? `Bearer ${token}` : undefined;
}
