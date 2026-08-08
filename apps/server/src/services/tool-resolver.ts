import {
  builtinTools,
  type ToolContext,
  type ToolDefinition,
  type UserConfig,
} from "@nakama/core";
import {
  isCrashIssueConfigured,
  loadCrashIssueConfig,
} from "@nakama/core/crash-issue-config";
import {
  isEmailConfigComplete,
  loadEmailConfig,
} from "@nakama/core/email-config";
import { CRASH_ISSUE_TOOL_NAME } from "@nakama/core/tools/crash-issue";
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
  emailConfigured: boolean,
  crashIssuesConfigured = false
): ToolDefinition[] {
  // Defaults to unavailable: only the maintainer of the repo being reported on sets a
  // token, so every other install must never see an issue-filing tool at all.
  return tools.filter((tool) => {
    if (!emailConfigured && tool.name === emailTool.name) {
      return false;
    }

    return crashIssuesConfigured || tool.name !== CRASH_ISSUE_TOOL_NAME;
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
    isEmailConfigComplete(await loadEmailConfig()),
    isCrashIssueConfigured(await loadCrashIssueConfig())
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
