import {
  builtinTools,
  type JsonSchema,
  type ListToolsResponse,
  NakamaApiError,
  type PluginActorRole,
  type PluginExecutionActor,
  type ToolContext,
  type ToolDefinition,
  type UserConfig,
} from "@nakama/core";
import {
  isEmailConfigComplete,
  loadEmailConfig,
} from "@nakama/core/email-config";
import { createCustomWebSearchTool } from "@nakama/core/tools/custom-web-search";
import { emailTool } from "@nakama/core/tools/email";
import { BROWSER_TOOL_IDS } from "@nakama/core/tools/protected";
import { loadWebSearchConfig } from "@nakama/core/web-search-config";
import type { DatabaseAdapter, StoredToolRecord } from "@nakama/db";
import { type BashInput, bashTool, runBash } from "../tools/bash";
import { createBrowserTools } from "../tools/browser-tools";
import {
  enrichAgentBrowserBashInput,
  isCloudBrowserRuntime,
} from "./agent-browser-service";
import { enrichCodingAgentBashInput } from "./coding-agent-bash-env";
import { getCustomToolHandler } from "./custom-tool-handlers";
import type { CustomToolRecord } from "./custom-tool-shared";
import type { OrgService } from "./org-service";
import type { PluginService } from "./plugin-service";
import { actorMayInvoke, PluginHostError } from "./plugin-service";

const BROWSER_TOOLS = createBrowserTools();

export type ServerToolOverrides = {
  googleMeet?: ToolDefinition[];
  generateImage?: ToolDefinition | null;
  saveArtifact?: ToolDefinition | null;
  session?: ToolDefinition[];
  subAgent?: ToolDefinition | null;
};

export type ResolveStoredToolsOptions = {
  orgService?: OrgService;
  actorRole?: PluginActorRole;
  pluginService?: PluginService | null;
  serverTools?: ServerToolOverrides;
  sharedContext?: ToolContext;
  userConfig?: UserConfig | null;
};

const BROWSER_TOOL_NAMES = new Set(Object.keys(BROWSER_TOOL_IDS));

export function omitUnavailableBuiltinTools(
  tools: ToolDefinition[],
  available: { cloudBrowser: boolean; email: boolean }
): ToolDefinition[] {
  return tools.filter(
    (tool) =>
      (available.email || tool.name !== emailTool.name) &&
      (available.cloudBrowser || !BROWSER_TOOL_NAMES.has(tool.name))
  );
}

/** The tool picker lists the browser tools only once Kernel is set up. */
export async function omitUnavailableToolDetails(
  response: ListToolsResponse
): Promise<ListToolsResponse> {
  if (await isCloudBrowserRuntime()) {
    return response;
  }

  return {
    ...response,
    tools: response.tools.filter((tool) => tool.handlerType !== "browser"),
  };
}

export async function resolveProfileStoredTools(
  records: CustomToolRecord[],
  db?: DatabaseAdapter,
  builtinOverrides: ToolDefinition[] = [],
  options: ResolveStoredToolsOptions = {}
): Promise<ToolDefinition[]> {
  // A configured search back-end replaces the provider-hosted web_search stub
  // for every caller; without one the stub stays and the provider searches.
  const customWebSearch = createCustomWebSearchTool(
    await loadWebSearchConfig()
  );

  const tools = await resolveToolsFromStorage(
    records,
    db,
    customWebSearch ? [...builtinOverrides, customWebSearch] : builtinOverrides,
    options
  );

  return omitUnavailableBuiltinTools(tools, {
    cloudBrowser: await isCloudBrowserRuntime(),
    email: isEmailConfigComplete(await loadEmailConfig()),
  });
}

export async function resolveToolsFromStorage(
  records: CustomToolRecord[],
  db?: DatabaseAdapter,
  builtinOverrides: ToolDefinition[] = [],
  options: ResolveStoredToolsOptions = {}
): Promise<ToolDefinition[]> {
  const builtinMap = new Map(
    [
      ...builtinTools,
      ...builtinOverrides,
      ...(options.serverTools?.googleMeet ?? []),
    ].map((tool) => [tool.name, tool])
  );

  const serverTools = buildServerTools(
    db,
    options.userConfig,
    options.serverTools,
    options.orgService
  );

  const resolved: ToolDefinition[] = [];

  for (const record of records) {
    const tool = await resolveStoredTool(
      record,
      builtinMap,
      serverTools,
      options.pluginService,
      options.actorRole,
      options.sharedContext
    );

    if (tool) {
      resolved.push(tool);
    }
  }

  return resolved;
}

async function resolveStoredTool(
  record: CustomToolRecord,
  builtinMap: Map<string, ToolDefinition>,
  serverTools: Map<string, ToolDefinition>,
  pluginService?: PluginService | null,
  actorRole?: PluginActorRole,
  sharedContext?: ToolContext
): Promise<ToolDefinition | null> {
  if (record.handlerType === "builtin") {
    return builtinMap.get(record.name) ?? null;
  }

  if (
    record.handlerType === "bash" ||
    record.handlerType === "sub_agent" ||
    record.handlerType === "generate_image" ||
    record.handlerType === "save_artifact" ||
    record.handlerType === "session" ||
    record.handlerType === "browser"
  ) {
    return serverTools.get(record.name) ?? null;
  }

  if (record.handlerType === "plugin") {
    return loadPluginTool(record, pluginService, actorRole);
  }

  const customHandler = getCustomToolHandler(record.handlerType);

  if (customHandler) {
    return customHandler.load(record, sharedContext);
  }

  return null;
}

function buildServerTools(
  db?: DatabaseAdapter,
  userConfig?: UserConfig | null,
  overrides: ServerToolOverrides = {},
  orgService?: OrgService
): Map<string, ToolDefinition> {
  const bash = db
    ? createCodingAgentAwareBashTool(db, userConfig, orgService)
    : bashTool;

  const map = new Map<string, ToolDefinition>([[bash.name, bash]]);

  if (overrides.subAgent) {
    map.set(overrides.subAgent.name, overrides.subAgent);
  }

  if (overrides.generateImage) {
    map.set(overrides.generateImage.name, overrides.generateImage);
  }

  if (overrides.saveArtifact) {
    map.set(overrides.saveArtifact.name, overrides.saveArtifact);
  }

  // Browser tools need no services: they read the Kernel settings and the
  // caller's org and user on each call.
  for (const tool of [...(overrides.session ?? []), ...BROWSER_TOOLS]) {
    map.set(tool.name, tool);
  }

  return map;
}

function createCodingAgentAwareBashTool(
  db: DatabaseAdapter,
  userConfig?: UserConfig | null,
  orgService?: OrgService
): ToolDefinition<BashInput> {
  return {
    ...bashTool,
    run: async (input, context: ToolContext) => {
      const enriched = await enrichCodingAgentBashInput(
        db,
        input,
        context,
        userConfig,
        orgService
      );

      return runBash(
        await enrichAgentBrowserBashInput(enriched, context),
        context
      );
    },
  };
}

async function loadPluginTool(
  record: StoredToolRecord,
  pluginService?: PluginService | null,
  actorRole?: PluginActorRole
): Promise<ToolDefinition | null> {
  const pluginId = record.pluginId;
  const actionKey = record.pluginKey;
  const orgId = record.orgId;

  if (!(pluginService && pluginId && actionKey && orgId)) {
    return null;
  }

  const action = await pluginService.getEnabledExposedAction(
    orgId,
    pluginId,
    actionKey
  );

  if (!action) {
    return null;
  }

  if (actorRole && !actorMayInvoke(action.access, actorRole)) {
    return null;
  }

  return {
    description: record.description,
    discoveryGroup: pluginId,
    name: record.name,
    parameters: isJsonSchema(action.inputSchema)
      ? action.inputSchema
      : undefined,
    async run(input, context) {
      const trustedOrgId = context.orgId?.trim();
      const trustedProfileId = context.profileId?.trim();

      if (!(trustedOrgId && trustedProfileId)) {
        throw new PluginHostError("invalid_input");
      }

      const invoked = await pluginService.invokePluginAction({
        access: "tool",
        actionKey,
        actor: pluginActorFromContext(context),
        input,
        orgId: trustedOrgId,
        pluginId,
        profileId: trustedProfileId,
        sessionId: context.sessionId,
        signal: context.signal,
      });

      return invoked.result;
    },
  };
}

export function pluginActorFromContext(
  context: ToolContext
): PluginExecutionActor {
  const messagingChannel =
    context.channel === "telegram" ||
    context.channel === "whatsapp" ||
    context.channel === "discord" ||
    context.channel === "slack";

  return {
    id: context.userId?.trim() ?? "",
    role: messagingChannel
      ? "member"
      : pluginActorRoleFromOrgRole(context.orgRole),
  };
}

function pluginActorRoleFromOrgRole(
  role: ToolContext["orgRole"]
): PluginActorRole {
  if (role === "admin" || role === "member") {
    return role;
  }

  throw new NakamaApiError("Forbidden", 403);
}

function isJsonSchema<T>(value: T): value is T & JsonSchema {
  return value instanceof Object && !Array.isArray(value);
}
