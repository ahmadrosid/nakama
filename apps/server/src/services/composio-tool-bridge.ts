import type {
  ComposioToolErrorResult,
  ToolContext,
  ToolDefinition,
} from "@nakama/core";
import {
  isLoopbackComposioCallbackBaseUrl,
  resolveComposioCallbackBaseUrl,
} from "./composio-callback-url";
import type { ComposioService } from "./composio-service";
import type { McpClientManager } from "./mcp-client-manager";

const COMPOSIO_META_TOOL_PATTERN = /^COMPOSIO_(MANAGE|WAIT|SEARCH|MULTI)/;
const composioSessionUrls = new Map<string, string>();

const MAX_SEARCH_DESCRIPTION_CHARS = 120;
const TRUNCATION_MARKER = "\n...[truncated]";
const MAX_COMPOSIO_TOOL_RESULT_CHARS = 16_000;

async function ensureComposioMcpConnection(
  mcpClientManager: McpClientManager,
  connectionKey: string,
  session: { url: string; headers?: Record<string, string> }
): Promise<void> {
  const cachedUrl = composioSessionUrls.get(connectionKey);

  if (cachedUrl !== session.url) {
    if (cachedUrl !== undefined) {
      await mcpClientManager.disconnectHttpEndpoint(connectionKey);
    }

    await mcpClientManager.connectHttpEndpoint(
      connectionKey,
      session.url,
      session.headers
    );
    composioSessionUrls.set(connectionKey, session.url);
    return;
  }

  if (!mcpClientManager.isHttpEndpointConnected(connectionKey)) {
    await mcpClientManager.connectHttpEndpoint(
      connectionKey,
      session.url,
      session.headers
    );
    composioSessionUrls.set(connectionKey, session.url);
  }
}

export function composioConnectionKey(
  orgId: string,
  userId: string,
  profileId: string
): string {
  return `composio:${orgId}:${userId}:${profileId}`;
}

function isBlockedComposioMetaTool(toolSlug: string): boolean {
  return COMPOSIO_META_TOOL_PATTERN.test(toolSlug);
}

function notConnectedError(toolkitSlug: string): ComposioToolErrorResult {
  return {
    code: "COMPOSIO_NOT_CONNECTED",
    error: `Composio toolkit "${toolkitSlug}" is not connected for your account. Call composio__connect_account with toolkit_slug "${toolkitSlug}" to generate an OAuth link for the user.`,
    toolkitSlug,
  };
}

interface ComposioConnectAccountInput {
  toolkit_slug: string;
}

interface SearchableAction {
  description: string;
  name: string;
  slug: string;
  toolkitSlug: string;
}

interface ComposioSearchActionsInput {
  query: string;
  toolkit_slug?: string;
}

interface ComposioInvokeActionInput {
  action_slug: string;
  arguments: Record<string, unknown>;
  toolkit_slug: string;
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
    orgToolkit: {
      toolkitSlug: string;
      cachedTools: Array<{ slug: string; name: string; description: string }>;
    };
    allowedActions: string[] | null;
  }>
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
        description: trimDescription(cachedTool.description),
        name: cachedTool.name,
        slug: cachedTool.slug,
        toolkitSlug: orgToolkit.toolkitSlug,
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
  actionSlug: string
): SearchableAction | undefined {
  return actions.find(
    (action) =>
      action.toolkitSlug === toolkitSlug.toLowerCase() &&
      action.slug === actionSlug.toUpperCase()
  );
}

function truncateComposioToolResult(result: unknown): unknown {
  const text = typeof result === "string" ? result : JSON.stringify(result);
  if (text.length <= MAX_COMPOSIO_TOOL_RESULT_CHARS) {
    return result;
  }
  const keep = Math.max(
    0,
    MAX_COMPOSIO_TOOL_RESULT_CHARS - TRUNCATION_MARKER.length
  );
  return {
    content: `${text.slice(0, keep)}${TRUNCATION_MARKER}`,
    truncated: true,
  };
}

export async function buildComposioConnectTools(
  orgId: string,
  userId: string,
  profileId: string,
  composioService: ComposioService
): Promise<ToolDefinition[]> {
  if (!userId) {
    return [];
  }

  if (!(await composioService.isAvailable())) {
    return [];
  }

  const assigned = await composioService.getAssignedToolkitRecords(
    orgId,
    userId,
    profileId
  );
  const needsConnection = assigned.filter(
    ({ orgToolkit, userConnection }) =>
      orgToolkit.status === "enabled" && userConnection?.status !== "connected"
  );

  if (needsConnection.length === 0) {
    return [];
  }

  const allowedSlugs = needsConnection.map(
    ({ orgToolkit }) => orgToolkit.toolkitSlug
  );
  const slugList = allowedSlugs.join(", ");

  return [
    {
      description: `Generate an OAuth link so the user can connect their personal account for an assigned Composio toolkit. Use when the user asks for Gmail, Slack, etc. but their connection is missing. Allowed toolkits: ${slugList}.`,
      name: "composio__connect_account",
      parameters: {
        properties: {
          toolkit_slug: {
            description: `Toolkit slug to connect. One of: ${slugList}`,
            type: "string",
          },
        },
        required: ["toolkit_slug"],
        type: "object",
      },
      async run(input, context: ToolContext) {
        const toolkitSlug =
          typeof input === "object" &&
          input &&
          typeof (input as ComposioConnectAccountInput).toolkit_slug ===
            "string"
            ? (input as ComposioConnectAccountInput).toolkit_slug.toLowerCase()
            : null;

        if (!(toolkitSlug && allowedSlugs.includes(toolkitSlug))) {
          return {
            code: "COMPOSIO_POLICY",
            error: `Invalid toolkit_slug. Use one of: ${slugList}`,
          } satisfies ComposioToolErrorResult;
        }

        try {
          const callbackBaseUrl = resolveComposioCallbackBaseUrl({
            clientOrigin: context.clientOrigin,
          });

          if (isLoopbackComposioCallbackBaseUrl(callbackBaseUrl)) {
            return {
              code: "COMPOSIO_POLICY",
              error:
                "Cannot start Composio OAuth from this channel: the callback URL is localhost. Set a reachable public web URL (Settings → Web public URL, or NAKAMA_WEB_PUBLIC_URL), restart the Telegram/WhatsApp/Discord bridge, then ask again.",
              toolkitSlug,
            } satisfies ComposioToolErrorResult;
          }

          const { redirectUrl } = await composioService.connectToolkit(
            orgId,
            userId,
            toolkitSlug,
            callbackBaseUrl
          );

          const displayName =
            needsConnection.find(
              ({ orgToolkit }) => orgToolkit.toolkitSlug === toolkitSlug
            )?.orgToolkit.displayName ?? toolkitSlug;

          return {
            displayName,
            instructions:
              "Reply with the link as clickable markdown. Tell the user to authorize, then return to chat and ask again.",
            message: `Share this link with the user so they can connect ${displayName}: ${redirectUrl}`,
            redirectUrl,
            toolkitSlug,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);

          return {
            code: "COMPOSIO_TRANSIENT",
            error: message,
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
  mcpClientManager: McpClientManager
): Promise<ToolDefinition[]> {
  if (!userId) {
    return [];
  }

  if (!(await composioService.isAvailable())) {
    return [];
  }

  const assigned = await composioService.getAssignedToolkitRecords(
    orgId,
    userId,
    profileId
  );
  if (assigned.length === 0) {
    return [];
  }

  const connectedAssignments = assigned.filter(
    ({ orgToolkit, userConnection }) =>
      orgToolkit.status === "enabled" &&
      userConnection?.status === "connected" &&
      orgToolkit.cachedTools.length > 0
  );

  if (connectedAssignments.length === 0) {
    return [];
  }

  const session = await composioService.getProfileSessionEndpoint(
    orgId,
    userId,
    profileId
  );
  if (!session) {
    return [];
  }

  const connectionKey = composioConnectionKey(orgId, userId, profileId);

  await ensureComposioMcpConnection(mcpClientManager, connectionKey, session);

  const searchableActions = buildSearchableActions(connectedAssignments);
  if (searchableActions.length === 0) {
    return [];
  }

  const toolkitSlugs = [
    ...new Set(searchableActions.map((action) => action.toolkitSlug)),
  ];
  const toolkitList = toolkitSlugs.join(", ");

  const searchTool: ToolDefinition = {
    description: `Search the Composio action catalog for this profile. Returns matching actions (slug, toolkit, name, short description) that the agent can then call via composio__invoke_action. Available toolkits: ${toolkitList}.`,
    name: "composio__search_actions",
    parameters: {
      properties: {
        query: {
          description:
            "Free-text query matched against action slug, name, and description (case-insensitive). Use an empty string to list all available actions.",
          type: "string",
        },
        toolkit_slug: {
          description: `Optional toolkit slug to scope the search. One of: ${toolkitList}.`,
          type: "string",
        },
      },
      required: ["query"],
      type: "object",
    },
    async run(input) {
      const parsed = input as ComposioSearchActionsInput;
      const query = typeof parsed?.query === "string" ? parsed.query : "";
      const toolkitSlug =
        typeof parsed?.toolkit_slug === "string"
          ? parsed.toolkit_slug.toLowerCase()
          : undefined;

      const matches = searchableActions.filter(
        (action) =>
          (toolkitSlug ? action.toolkitSlug === toolkitSlug : true) &&
          actionMatchesQuery(action, query)
      );

      return {
        actions: matches.map((action) => ({
          action_slug: action.slug,
          description: action.description,
          name: action.name,
          toolkit_slug: action.toolkitSlug,
        })),
        count: matches.length,
      };
    },
  };

  const invokeTool: ToolDefinition = {
    description: `Invoke a Composio action by toolkit and action slug. Use composio__search_actions first to find the right action_slug, then call this with the action's arguments. Available toolkits: ${toolkitList}.`,
    name: "composio__invoke_action",
    parameters: {
      properties: {
        action_slug: {
          description:
            "Action slug returned by composio__search_actions (uppercase, e.g. GMAIL_SEND_EMAIL).",
          type: "string",
        },
        arguments: {
          additionalProperties: true,
          description:
            "Arguments object for the action. Use composio__search_actions to discover the action, then provide the arguments it needs.",
          type: "object",
        },
        toolkit_slug: {
          description: `Toolkit slug the action belongs to. One of: ${toolkitList}.`,
          type: "string",
        },
      },
      required: ["toolkit_slug", "action_slug", "arguments"],
      type: "object",
    },
    async run(input) {
      const parsed = input as ComposioInvokeActionInput;
      const toolkitSlug =
        typeof parsed?.toolkit_slug === "string"
          ? parsed.toolkit_slug.toLowerCase()
          : null;
      const actionSlug =
        typeof parsed?.action_slug === "string"
          ? parsed.action_slug.toUpperCase()
          : null;
      const args =
        parsed?.arguments &&
        typeof parsed.arguments === "object" &&
        !Array.isArray(parsed.arguments)
          ? (parsed.arguments as Record<string, unknown>)
          : {};

      if (!(toolkitSlug && actionSlug)) {
        return {
          code: "COMPOSIO_POLICY",
          error: "toolkit_slug and action_slug are required.",
        } satisfies ComposioToolErrorResult;
      }

      const action = findSearchableAction(
        searchableActions,
        toolkitSlug,
        actionSlug
      );
      if (!action) {
        return {
          code: "COMPOSIO_POLICY",
          error: `Action "${actionSlug}" is not available for toolkit "${toolkitSlug}" on this profile. Call composio__search_actions to discover available actions.`,
          toolkitSlug,
        } satisfies ComposioToolErrorResult;
      }

      const assignment = connectedAssignments.find(
        ({ orgToolkit }) => orgToolkit.toolkitSlug === action.toolkitSlug
      );
      const userConnection = assignment?.userConnection;
      if (userConnection?.status !== "connected") {
        return notConnectedError(action.toolkitSlug);
      }

      try {
        await ensureComposioMcpConnection(
          mcpClientManager,
          connectionKey,
          session
        );

        const result = await mcpClientManager.callHttpEndpointTool(
          connectionKey,
          action.slug,
          args
        );

        return truncateComposioToolResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (/auth|connect|oauth|unauthorized/i.test(message)) {
          return notConnectedError(action.toolkitSlug);
        }

        return {
          code: "COMPOSIO_TRANSIENT",
          error: message,
          toolkitSlug: action.toolkitSlug,
        } satisfies ComposioToolErrorResult;
      }
    },
  };

  return [searchTool, invokeTool];
}
