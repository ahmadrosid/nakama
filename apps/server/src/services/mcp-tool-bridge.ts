import type { JsonSchema, ToolDefinition } from "@tinyclaw/core";
import { emptyObjectSchema } from "@tinyclaw/core";
import type { StoredMcpServerRecord } from "@tinyclaw/db";
import type { McpClientManager } from "./mcp-client-manager";

const LLM_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function buildMcpToolDefinitions(
  servers: StoredMcpServerRecord[],
  manager: McpClientManager,
  profileId: string,
): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const usedNames = new Set<string>();

  for (const server of servers) {
    for (const cachedTool of server.cachedTools) {
      const name = uniqueLlmToolName(
        namespacedMcpToolName(server.name, cachedTool.name),
        usedNames,
      );
      usedNames.add(name);

      tools.push({
        name,
        description: cachedTool.description,
        parameters: toJsonSchema(cachedTool.inputSchema),
        async run(input) {
          try {
            if (server.transport === "stdio") {
              await manager.ensureConnected(server, profileId);
            } else if (!manager.isConnected(server.id, server.transport)) {
              return {
                error: `MCP server "${server.name}" is not connected.`,
              };
            }

            return await manager.callTool(
              server.id,
              server.transport,
              cachedTool.name,
              input,
              server.transport === "stdio" ? profileId : undefined,
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

export function namespacedMcpToolName(serverName: string, toolName: string): string {
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
