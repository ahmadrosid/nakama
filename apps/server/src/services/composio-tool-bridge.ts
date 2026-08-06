import type { ComposioToolErrorResult, ToolContext, ToolDefinition } from "@nakama/core";
import {
  isLoopbackComposioCallbackBaseUrl,
  resolveComposioCallbackBaseUrl,
} from "./composio-callback-url";
import type { ComposioService } from "./composio-service";
import type { McpClientManager } from "./mcp-client-manager";
import { sanitizeLlmToolNamePart } from "./mcp-tool-bridge";

const COMPOSIO_META_TOOL_PATTERN = /^COMPOSIO_(MANAGE|WAIT|SEARCH|MULTI)/;
const composioSessionUrls = new Map<string, string>();

const MAX_SEARCH_DESCRIPTION_CHARS = 120;
const TRUNCATION_MARKER = "\n...[truncated]";
const MAX_COMPOSIO_TOOL_RESULT_CHARS = 16_000;

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

interface SearchableAction {
  toolkitSlug: string;
  slug: string;
  name: string;
  description: string;
}

interface ComposioSearchActionsInput {
  query: string;
  toolkit_slug?: string;
}

interface ComposioInvokeActionInput {
  toolkit_slug: string;
  action_slug: string;
  arguments: Record<string, unknown>;
}

function trimDescription(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (text.length <= MAX_SEARCH_DESCRIPTION_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_SEARCH_DESCRIPTION_CHARS - 1)}…`;
}

function buildSearchableActions(
  connectedAssignments: Array<{
    orgToolkit: { toolkitSlug: string; cachedTools: Array<{ slug: string; name: string; description: string }> };
    allowedActions: string[] | null;
  }>,
): SearchableAction[] {
  const actions: SearchableAction[] = [];

  for (const { orgToolkit, allowedActions } of connectedAssignments) {
    for (const cachedTool of orgToolkit.cachedTools) {
      if (isBlockedComposioMetaTool(cachedTool.slug)) {
        continue;
      }
      if (allowedActions && !allowedActions.includes(cachedTool.slug)) {
        continue;
      }
      actions.push({
        toolkitSlug: orgToolkit.toolkitSlug,
        slug: cachedTool.slug,
        name: cachedTool.name,
        description: trimDescription(cachedTool.description),
      });
    }
  }

  return actions;
}

function actionMatchesQuery(action: SearchableAction, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return true;
  }
  return (
    action.slug.toLowerCase().includes(needle) ||
    action.name.toLowerCase().includes(needle) ||
    action.description.toLowerCase().includes(needle)
  );
}

function findSearchableAction(
  actions: SearchableAction[],
  toolkitSlug: string,
  actionSlug: string,
): SearchableAction | undefined {
  return actions.find(
    (action) =>
      action.toolkitSlug === toolkitSlug.toLowerCase() && action.slug === actionSlug.toUpperCase(),
  );
}

function truncateComposioToolResult(result: unknown): unknown {
  const text = typeof result === "string" ? result : JSON.stringify(result);
  if (text.length <= MAX_COMPOSIO_TOOL_RESULT_CHARS) {
    return result;
  }
  const keep = Math.max(0, MAX_COMPOSIO_TOOL_RESULT_CHARS - TRUNCATION_MARKER.length);
  return {
    truncated: true,
    content: `${text.slice(0, keep)}${TRUNCATION_MARKER}`,
  };
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

  const searchableActions = buildSearchableActions(connectedAssignments);
  if (searchableActions.length === 0) {
    return [];
  }

  const toolkitSlugs = [...new Set(searchableActions.map((action) => action.toolkitSlug))];
  const toolkitList = toolkitSlugs.join(", ");

  const searchTool: ToolDefinition = {
    name: "composio__search_actions",
    description: `Search the Composio action catalog for this profile. Returns matching actions (slug, toolkit, name, short description) that the agent can then call via composio__invoke_action. Available toolkits: ${toolkitList}.`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text query matched against action slug, name, and description (case-insensitive). Use an empty string to list all available actions.",
        },
        toolkit_slug: {
          type: "string",
          description: `Optional toolkit slug to scope the search. One of: ${toolkitList}.`,
        },
      },
      required: ["query"],
    },
    async run(input) {
      const parsed = input as ComposioSearchActionsInput;
      const query = typeof parsed?.query === "string" ? parsed.query : "";
      const toolkitSlug =
        typeof parsed?.toolkit_slug === "string" ? parsed.toolkit_slug.toLowerCase() : undefined;

      const matches = searchableActions.filter(
        (action) =>
          (toolkitSlug ? action.toolkitSlug === toolkitSlug : true) &&
          actionMatchesQuery(action, query),
      );

      return {
        actions: matches.map((action) => ({
          toolkit_slug: action.toolkitSlug,
          action_slug: action.slug,
          name: action.name,
          description: action.description,
        })),
        count: matches.length,
      };
    },
  };

  const invokeTool: ToolDefinition = {
    name: "composio__invoke_action",
    description: `Invoke a Composio action by toolkit and action slug. Use composio__search_actions first to find the right action_slug, then call this with the action's arguments. Available toolkits: ${toolkitList}.`,
    parameters: {
      type: "object",
      properties: {
        toolkit_slug: {
          type: "string",
          description: `Toolkit slug the action belongs to. One of: ${toolkitList}.`,
        },
        action_slug: {
          type: "string",
          description: "Action slug returned by composio__search_actions (uppercase, e.g. GMAIL_SEND_EMAIL).",
        },
        arguments: {
          type: "object",
          description: "Arguments object for the action. Use composio__search_actions to discover the action, then provide the arguments it needs.",
          additionalProperties: true,
        },
      },
      required: ["toolkit_slug", "action_slug", "arguments"],
    },
    async run(input) {
      const parsed = input as ComposioInvokeActionInput;
      const toolkitSlug =
        typeof parsed?.toolkit_slug === "string" ? parsed.toolkit_slug.toLowerCase() : null;
      const actionSlug =
        typeof parsed?.action_slug === "string" ? parsed.action_slug.toUpperCase() : null;
      const args =
        parsed?.arguments && typeof parsed.arguments === "object" && !Array.isArray(parsed.arguments)
          ? (parsed.arguments as Record<string, unknown>)
          : {};

      if (!toolkitSlug || !actionSlug) {
        return {
          error: "toolkit_slug and action_slug are required.",
          code: "COMPOSIO_POLICY",
        } satisfies ComposioToolErrorResult;
      }

      const action = findSearchableAction(searchableActions, toolkitSlug, actionSlug);
      if (!action) {
        return {
          error: `Action "${actionSlug}" is not available for toolkit "${toolkitSlug}" on this profile. Call composio__search_actions to discover available actions.`,
          code: "COMPOSIO_POLICY",
          toolkitSlug,
        } satisfies ComposioToolErrorResult;
      }

      const assignment = connectedAssignments.find(
        ({ orgToolkit }) => orgToolkit.toolkitSlug === action.toolkitSlug,
      );
      const userConnection = assignment?.userConnection;
      if (userConnection?.status !== "connected") {
        return notConnectedError(action.toolkitSlug);
      }

      try {
        await ensureComposioMcpConnection(mcpClientManager, connectionKey, session);

        const result = await mcpClientManager.callHttpEndpointTool(
          connectionKey,
          action.slug,
          args,
        );

        return truncateComposioToolResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (/auth|connect|oauth|unauthorized/i.test(message)) {
          return notConnectedError(action.toolkitSlug);
        }

        return {
          error: message,
          code: "COMPOSIO_TRANSIENT",
          toolkitSlug: action.toolkitSlug,
        } satisfies ComposioToolErrorResult;
      }
    },
  };

  return [searchTool, invokeTool];
}
