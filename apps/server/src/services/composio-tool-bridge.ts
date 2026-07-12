import type { ComposioToolErrorResult, ToolDefinition } from "@nakama/core";
import { emptyObjectSchema } from "@nakama/core";
import type { StoredComposioToolkitRecord } from "@nakama/db";
import type { ComposioService } from "./composio-service";
import type { McpClientManager } from "./mcp-client-manager";
import { sanitizeLlmToolNamePart } from "./mcp-tool-bridge";

const COMPOSIO_META_TOOL_PATTERN = /^COMPOSIO_(MANAGE|WAIT|SEARCH|MULTI)/;

export function composioConnectionKey(orgId: string, profileId: string): string {
  return `composio:${orgId}:${profileId}`;
}

export function namespacedComposioToolName(toolkitSlug: string, toolSlug: string): string {
  return `composio__${sanitizeLlmToolNamePart(toolkitSlug)}__${sanitizeLlmToolNamePart(toolSlug)}`;
}

function isBlockedComposioMetaTool(toolSlug: string): boolean {
  return COMPOSIO_META_TOOL_PATTERN.test(toolSlug);
}

function toJsonSchema(inputSchema: Record<string, unknown> | undefined) {
  if (inputSchema && typeof inputSchema === "object") {
    return inputSchema;
  }

  return emptyObjectSchema;
}

function notConnectedError(toolkitSlug: string): ComposioToolErrorResult {
  return {
    error: `Composio toolkit "${toolkitSlug}" is not connected. Ask an org admin to connect it on Integrations.`,
    code: "COMPOSIO_NOT_CONNECTED",
    toolkitSlug,
  };
}

export async function buildComposioToolDefinitions(
  orgId: string,
  profileId: string,
  composioService: ComposioService,
  mcpClientManager: McpClientManager,
): Promise<ToolDefinition[]> {
  if (!(await composioService.isAvailable())) {
    return [];
  }

  const assigned = await composioService.getAssignedToolkitRecords(orgId, profileId);
  if (assigned.length === 0) {
    return [];
  }

  const connectedAssignments = assigned.filter(
    ({ toolkit }) => toolkit.status === "connected" && toolkit.cachedTools.length > 0,
  );

  if (connectedAssignments.length === 0) {
    return [];
  }

  const session = await composioService.getProfileSessionEndpoint(orgId, profileId);
  if (!session) {
    return [];
  }

  const connectionKey = composioConnectionKey(orgId, profileId);

  if (!mcpClientManager.isHttpEndpointConnected(connectionKey)) {
    await mcpClientManager.connectHttpEndpoint(connectionKey, session.url, session.headers);
  }

  const tools: ToolDefinition[] = [];
  const usedNames = new Set<string>();

  for (const { toolkit, allowedActions } of connectedAssignments) {
    for (const cachedTool of toolkit.cachedTools) {
      if (isBlockedComposioMetaTool(cachedTool.slug)) {
        continue;
      }

      if (allowedActions && !allowedActions.includes(cachedTool.slug)) {
        continue;
      }

      const baseName = namespacedComposioToolName(toolkit.toolkitSlug, cachedTool.slug);
      let name = baseName;
      let suffix = 2;

      while (usedNames.has(name)) {
        name = `${baseName}_${suffix}`;
        suffix += 1;
      }

      usedNames.add(name);

      tools.push({
        name,
        description: cachedTool.description,
        parameters: toJsonSchema(cachedTool.inputSchema),
        async run(input) {
          if (toolkit.status !== "connected") {
            return notConnectedError(toolkit.toolkitSlug);
          }

          try {
            if (!mcpClientManager.isHttpEndpointConnected(connectionKey)) {
              await mcpClientManager.connectHttpEndpoint(
                connectionKey,
                session.url,
                session.headers,
              );
            }

            return await mcpClientManager.callHttpEndpointTool(
              connectionKey,
              cachedTool.slug,
              input,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            if (/auth|connect|oauth|unauthorized/i.test(message)) {
              return notConnectedError(toolkit.toolkitSlug);
            }

            return {
              error: message,
              code: "COMPOSIO_TRANSIENT",
              toolkitSlug: toolkit.toolkitSlug,
            } satisfies ComposioToolErrorResult;
          }
        },
      });
    }
  }

  return tools;
}
