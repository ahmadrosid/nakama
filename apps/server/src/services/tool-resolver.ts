import type { DatabaseAdapter, StoredToolRecord } from "@nakama/db";
import { builtinTools, type ToolDefinition } from "@nakama/core";
import { isEmailConfigComplete, loadEmailConfig } from "@nakama/core/email-config";
import { emailTool } from "@nakama/core/tools/email";
import { bashTool } from "../tools/bash";
import { loadJavascriptTool } from "./javascript-tool-loader";

export function omitUnavailableBuiltinTools(
  tools: ToolDefinition[],
  emailConfigured: boolean,
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
): Promise<ToolDefinition[]> {
  const tools = await resolveToolsFromStorage(records, db, builtinOverrides);
  return omitUnavailableBuiltinTools(
    tools,
    isEmailConfigComplete(await loadEmailConfig()),
  );
}

export async function resolveToolsFromStorage(
  records: StoredToolRecord[],
  db?: DatabaseAdapter,
  builtinOverrides: ToolDefinition[] = [],
): Promise<ToolDefinition[]> {
  const builtinMap = new Map(
    [...builtinTools, ...builtinOverrides].map((tool) => [tool.name, tool]),
  );
  const serverTools = buildServerTools(db);
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
  serverTools: Map<string, ToolDefinition>,
): Promise<ToolDefinition | null> {
  if (record.handlerType === "builtin") {
    return builtinMap.get(record.name) ?? null;
  }

  if (record.handlerType === "bash") {
    return serverTools.get(record.name) ?? null;
  }

  if (record.handlerType === "javascript") {
    return loadJavascriptTool(record);
  }

  return null;
}

function buildServerTools(_db?: DatabaseAdapter): Map<string, ToolDefinition> {
  return new Map<string, ToolDefinition>([[bashTool.name, bashTool]]);
}
