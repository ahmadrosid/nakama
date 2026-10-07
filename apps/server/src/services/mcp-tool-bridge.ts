import type { JsonSchema, ToolDefinition } from "@nakama/core";
import { emptyObjectSchema } from "@nakama/core";
import type { DatabaseAdapter, StoredMcpServerRecord } from "@nakama/db";
import type { McpService } from "./mcp-service";

const LLM_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function buildMcpToolDefinitions(
  servers: StoredMcpServerRecord[],
  mcpService: Pick<McpService, "callTool">,
  db: Pick<DatabaseAdapter, "getMcpServer">,
  orgId: string,
  profileId: string
): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const usedNames = new Set<string>();

  for (const server of servers) {
    if (!server.enabled) {
      continue;
    }

    for (const cachedTool of server.cachedTools) {
      const name = uniqueLlmToolName(
        namespacedMcpToolName(server.name, cachedTool.name),
        usedNames
      );
      usedNames.add(name);

      tools.push({
        description: cachedTool.description,
        name,
        parameters: toJsonSchema(cachedTool.inputSchema),
        async run(input) {
          try {
            const currentServer = await db.getMcpServer(server.id);

            if (!currentServer?.enabled) {
              return {
                error: `MCP server "${server.name}" is disabled.`,
              };
            }

            return await mcpService.callTool(
              currentServer,
              cachedTool.name,
              input,
              orgId,
              profileId
            );
          } catch (error) {
            return {
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
      });
    }
  }

  return tools;
}

export function sanitizeLlmToolNamePart(name: string): string {
  const sanitized = name
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized || "tool";
}

export function namespacedMcpToolName(
  serverName: string,
  toolName: string
): string {
  return `${sanitizeLlmToolNamePart(serverName)}__${sanitizeLlmToolNamePart(toolName)}`;
}

export function isValidLlmToolName(name: string): boolean {
  return LLM_TOOL_NAME_PATTERN.test(name);
}

function uniqueLlmToolName(base: string, usedNames: Set<string>): string {
  if (!usedNames.has(base)) {
    return base;
  }

  let suffix = 2;

  while (usedNames.has(`${base}_${suffix}`)) {
    suffix += 1;
  }

  return `${base}_${suffix}`;
}

function toJsonSchema(inputSchema: unknown): JsonSchema {
  if (typeof inputSchema === "object" && inputSchema !== null) {
    return inputSchema as JsonSchema;
  }

  return emptyObjectSchema();
}
