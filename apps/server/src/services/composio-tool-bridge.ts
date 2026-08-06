import type { ComposioToolErrorResult, ToolContext, ToolDefinition } from "@nakama/core";
import { emptyObjectSchema } from "@nakama/core";
import {
  isLoopbackComposioCallbackBaseUrl,
  resolveComposioCallbackBaseUrl,
} from "./composio-callback-url";
import type { ComposioService } from "./composio-service";
import type { McpClientManager } from "./mcp-client-manager";
import { sanitizeLlmToolNamePart } from "./mcp-tool-bridge";

const COMPOSIO_META_TOOL_PATTERN = /^COMPOSIO_(MANAGE|WAIT|SEARCH|MULTI)/;
const composioSessionUrls = new Map<string, string>();

async function ensureComposioMcpConnection(
  mcpClientManager: McpClientManager,
  connectionKey: string,
  session: { url: string; headers?: Record<string, string> },
): Promise<void> {
  const cachedUrl = composioSessionUrls.get(connectionKey);

  if (cachedUrl !== session.url) {
    if (cachedUrl !== undefined) {
      await mcpClientManager.disconnectHttpEndpoint(connectionKey);
    }

    await mcpClientManager.connectHttpEndpoint(connectionKey, session.url, session.headers);
    composioSessionUrls.set(connectionKey, session.url);
    return;
  }

  if (!mcpClientManager.isHttpEndpointConnected(connectionKey)) {
    await mcpClientManager.connectHttpEndpoint(connectionKey, session.url, session.headers);
    composioSessionUrls.set(connectionKey, session.url);
  }
}

export function composioConnectionKey(orgId: string, userId: string, profileId: string): string {
  return `composio:${orgId}:${userId}:${profileId}`;
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
    error: `Composio toolkit "${toolkitSlug}" is not connected for your account. Call composio__connect_account with toolkit_slug "${toolkitSlug}" to generate an OAuth link for the user.`,
    code: "COMPOSIO_NOT_CONNECTED",
    toolkitSlug,
  };
}

interface ComposioConnectAccountInput {
  toolkit_slug: string;
}

export async function buildComposioConnectTools(
  orgId: string,
  userId: string,
  profileId: string,
  composioService: ComposioService,
): Promise<ToolDefinition[]> {
  if (!userId) {
    return [];
  }

  if (!(await composioService.isAvailable())) {
    return [];
  }

  const assigned = await composioService.getAssignedToolkitRecords(orgId, userId, profileId);
  const needsConnection = assigned.filter(
    ({ orgToolkit, userConnection }) =>
      orgToolkit.status === "enabled" && userConnection?.status !== "connected",
  );

  if (needsConnection.length === 0) {
    return [];
  }

  const allowedSlugs = needsConnection.map(({ orgToolkit }) => orgToolkit.toolkitSlug);
  const slugList = allowedSlugs.join(", ");

  return [
    {
      name: "composio__connect_account",
      description: `Generate an OAuth link so the user can connect their personal account for an assigned Composio toolkit. Use when the user asks for Gmail, Slack, etc. but their connection is missing. Allowed toolkits: ${slugList}.`,
      parameters: {
        type: "object",
        properties: {
          toolkit_slug: {
            type: "string",
            description: `Toolkit slug to connect. One of: ${slugList}`,
          },
        },
        required: ["toolkit_slug"],
      },
      async run(input, context: ToolContext) {
        const toolkitSlug =
          typeof input === "object" &&
          input &&
          typeof (input as ComposioConnectAccountInput).toolkit_slug === "string"
            ? (input as ComposioConnectAccountInput).toolkit_slug.toLowerCase()
            : null;

        if (!toolkitSlug || !allowedSlugs.includes(toolkitSlug)) {
          return {
            error: `Invalid toolkit_slug. Use one of: ${slugList}`,
            code: "COMPOSIO_POLICY",
          } satisfies ComposioToolErrorResult;
        }

        try {
          const callbackBaseUrl = resolveComposioCallbackBaseUrl({
            clientOrigin: context.clientOrigin,
          });

          if (isLoopbackComposioCallbackBaseUrl(callbackBaseUrl)) {
            return {
              error:
                "Cannot start Composio OAuth from this channel: the callback URL is localhost. Set a reachable public web URL (Settings → Web public URL, or NAKAMA_WEB_PUBLIC_URL), restart the Telegram/WhatsApp/Discord bridge, then ask again.",
              code: "COMPOSIO_POLICY",
              toolkitSlug,
            } satisfies ComposioToolErrorResult;
          }

          const { redirectUrl } = await composioService.connectToolkit(
            orgId,
            userId,
            toolkitSlug,
            callbackBaseUrl,
          );

          const displayName =
            needsConnection.find(({ orgToolkit }) => orgToolkit.toolkitSlug === toolkitSlug)
              ?.orgToolkit.displayName ?? toolkitSlug;

          return {
            toolkitSlug,
            displayName,
            redirectUrl,
            message: `Share this link with the user so they can connect ${displayName}: ${redirectUrl}`,
            instructions:
              "Reply with the link as clickable markdown. Tell the user to authorize, then return to chat and ask again.",
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          return {
            error: message,
            code: "COMPOSIO_TRANSIENT",
            toolkitSlug,
          } satisfies ComposioToolErrorResult;
        }
      },
    },
  ];
}

export async function buildComposioToolDefinitions(
  orgId: string,
  userId: string,
  profileId: string,
  composioService: ComposioService,
  mcpClientManager: McpClientManager,
): Promise<ToolDefinition[]> {
  if (!userId) {
    return [];
  }

  if (!(await composioService.isAvailable())) {
    return [];
  }

  const assigned = await composioService.getAssignedToolkitRecords(orgId, userId, profileId);
  if (assigned.length === 0) {
    return [];
  }

  const connectedAssignments = assigned.filter(
    ({ orgToolkit, userConnection }) =>
      orgToolkit.status === "enabled" &&
      userConnection?.status === "connected" &&
      orgToolkit.cachedTools.length > 0,
  );

  if (connectedAssignments.length === 0) {
    return [];
  }

  const session = await composioService.getProfileSessionEndpoint(orgId, userId, profileId);
  if (!session) {
    return [];
  }

  const connectionKey = composioConnectionKey(orgId, userId, profileId);

  await ensureComposioMcpConnection(mcpClientManager, connectionKey, session);

  const tools: ToolDefinition[] = [];
  const usedNames = new Set<string>();

  for (const { orgToolkit, userConnection, allowedActions } of connectedAssignments) {
    for (const cachedTool of orgToolkit.cachedTools) {
      if (isBlockedComposioMetaTool(cachedTool.slug)) {
        continue;
      }

      if (allowedActions && !allowedActions.includes(cachedTool.slug)) {
        continue;
      }

      const baseName = namespacedComposioToolName(orgToolkit.toolkitSlug, cachedTool.slug);
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
          if (userConnection?.status !== "connected") {
            return notConnectedError(orgToolkit.toolkitSlug);
          }

          try {
            await ensureComposioMcpConnection(mcpClientManager, connectionKey, session);

            return await mcpClientManager.callHttpEndpointTool(
              connectionKey,
              cachedTool.slug,
              input,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            if (/auth|connect|oauth|unauthorized/i.test(message)) {
              return notConnectedError(orgToolkit.toolkitSlug);
            }

            return {
              error: message,
              code: "COMPOSIO_TRANSIENT",
              toolkitSlug: orgToolkit.toolkitSlug,
            } satisfies ComposioToolErrorResult;
          }
        },
      });
    }
  }

  return tools;
}
