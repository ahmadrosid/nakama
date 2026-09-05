import {
  builtinTools,
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
import { loadWebSearchConfig } from "@nakama/core/web-search-config";
import type { DatabaseAdapter, StoredToolRecord } from "@nakama/db";
import { bashTool, runBash } from "../tools/bash";
import { enrichCodingAgentBashInput } from "./coding-agent-bash-env";
import { getCustomToolHandler } from "./custom-tool-handlers";

export type ServerToolOverrides = {
  generateImage?: ToolDefinition | null;
  session?: ToolDefinition[];
  subAgent?: ToolDefinition | null;
};

export function omitUnavailableBuiltinTools(
  tools: ToolDefinition[],
  emailConfigured: boolean
): ToolDefinition[] {
  if (emailConfigured) {
    return tools;
  }

  return tools.filter((tool) => tool.name !== emailTool.name);
}

export async function resolveProfileStoredTools(
  records: StoredToolRecord[],
  db?: DatabaseAdapter,
  builtinOverrides: ToolDefinition[] = [],
  options: {
    serverTools?: ServerToolOverrides;
    userConfig?: UserConfig | null;
  } = {}
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
  return omitUnavailableBuiltinTools(
    tools,
    isEmailConfigComplete(await loadEmailConfig())
  );
}

export async function resolveToolsFromStorage(
  records: StoredToolRecord[],
  db?: DatabaseAdapter,
  builtinOverrides: ToolDefinition[] = [],
  options: {
    serverTools?: ServerToolOverrides;
    userConfig?: UserConfig | null;
  } = {}
): Promise<ToolDefinition[]> {
  const builtinMap = new Map(
    [...builtinTools, ...builtinOverrides].map((tool) => [tool.name, tool])
  );
  const serverTools = buildServerTools(
    db,
    options.userConfig,
    options.serverTools
  );
  const resolved: ToolDefinition[] = [];

  for (const record of records) {
    const tool = await resolveStoredTool(record, builtinMap, serverTools);

    if (tool) {
      resolved.push(tool);
    }
  }

  return resolved;
}

async function resolveStoredTool(
  record: StoredToolRecord,
  builtinMap: Map<string, ToolDefinition>,
  serverTools: Map<string, ToolDefinition>
): Promise<ToolDefinition | null> {
  if (record.handlerType === "builtin") {
    return builtinMap.get(record.name) ?? null;
  }

  if (
    record.handlerType === "bash" ||
    record.handlerType === "sub_agent" ||
    record.handlerType === "generate_image" ||
    record.handlerType === "session"
  ) {
    return serverTools.get(record.name) ?? null;
  }

  const customHandler = getCustomToolHandler(record.handlerType);

  if (customHandler) {
    return customHandler.load(record);
  }

  return null;
}

function buildServerTools(
  db?: DatabaseAdapter,
  userConfig?: UserConfig | null,
  overrides: ServerToolOverrides = {}
): Map<string, ToolDefinition> {
  const bash = db ? createCodingAgentAwareBashTool(db, userConfig) : bashTool;
  const map = new Map<string, ToolDefinition>([[bash.name, bash]]);

  if (overrides.subAgent) {
    map.set(overrides.subAgent.name, overrides.subAgent);
  }

  if (overrides.generateImage) {
    map.set(overrides.generateImage.name, overrides.generateImage);
  }

  for (const tool of overrides.session ?? []) {
    map.set(tool.name, tool);
  }

  return map;
}

function createCodingAgentAwareBashTool(
  db: DatabaseAdapter,
  userConfig?: UserConfig | null
): ToolDefinition {
  return {
    ...bashTool,
    run: async (input, context: ToolContext) => {
      const enriched = await enrichCodingAgentBashInput(
        db,
        input,
        context,
        userConfig
      );
      return runBash(enriched, context);
    },
  };
}
