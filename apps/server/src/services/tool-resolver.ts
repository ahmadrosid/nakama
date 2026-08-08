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
import { emailTool } from "@nakama/core/tools/email";
import type { DatabaseAdapter, StoredToolRecord } from "@nakama/db";

import { bashTool, runBash } from "../tools/bash";
import { enrichCodingAgentBashInput } from "./coding-agent-bash-env";
import { loadJavascriptTool } from "./javascript-tool-loader";

let registeredSubAgentTool: ToolDefinition | null = null;
let registeredGenerateImageTool: ToolDefinition | null = null;

export function registerSubAgentTool(tool: ToolDefinition): void {
  registeredSubAgentTool = tool;
}

export function registerGenerateImageTool(tool: ToolDefinition | null): void {
  registeredGenerateImageTool = tool;
}

export function omitUnavailableBuiltinTools(
  tools: ToolDefinition[],
  emailConfigured: boolean
): ToolDefinition[] {
  return tools.filter((tool) => {
    if (!emailConfigured && tool.name === emailTool.name) {
      return false;
    }

    return true;
  });
}

export async function resolveProfileStoredTools(
  records: StoredToolRecord[],
  db?: DatabaseAdapter,
  builtinOverrides: ToolDefinition[] = [],
  options: { userConfig?: UserConfig | null } = {}
): Promise<ToolDefinition[]> {
  const tools = await resolveToolsFromStorage(
    records,
    db,
    builtinOverrides,
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
  options: { userConfig?: UserConfig | null } = {}
): Promise<ToolDefinition[]> {
  const builtinMap = new Map(
    [...builtinTools, ...builtinOverrides].map((tool) => [tool.name, tool])
  );
  const serverTools = buildServerTools(db, options.userConfig);
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

  if (record.handlerType === "bash") {
    return serverTools.get(record.name) ?? null;
  }

  if (record.handlerType === "sub_agent") {
    return serverTools.get(record.name) ?? null;
  }

  if (record.handlerType === "generate_image") {
    return serverTools.get(record.name) ?? null;
  }

  if (record.handlerType === "javascript") {
    return loadJavascriptTool(record);
  }

  return null;
}

function buildServerTools(
  db?: DatabaseAdapter,
  userConfig?: UserConfig | null
): Map<string, ToolDefinition> {
  const bash = db ? createCodingAgentAwareBashTool(db, userConfig) : bashTool;
  const map = new Map<string, ToolDefinition>([[bash.name, bash]]);

  if (registeredSubAgentTool) {
    map.set(registeredSubAgentTool.name, registeredSubAgentTool);
  }

  if (registeredGenerateImageTool) {
    map.set(registeredGenerateImageTool.name, registeredGenerateImageTool);
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
