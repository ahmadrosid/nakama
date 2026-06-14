import type { StoredToolRecord } from "@tinyclaw/db";
import { builtinTools, type ToolDefinition } from "@tinyclaw/core";
import { bashTool } from "../tools/bash";
import { loadJavascriptTool } from "./javascript-tool-loader";

const SERVER_TOOLS = new Map<string, ToolDefinition>([[bashTool.name, bashTool]]);

export async function resolveToolsFromStorage(
  records: StoredToolRecord[],
  builtinOverrides: ToolDefinition[] = [],
): Promise<ToolDefinition[]> {
  const builtinMap = new Map(
    [...builtinTools, ...builtinOverrides].map((tool) => [tool.name, tool]),
  );
  const resolved: ToolDefinition[] = [];

  for (const record of records) {
    const tool = await resolveStoredTool(record, builtinMap);

    if (tool) {
      resolved.push(tool);
    }
  }

  return resolved;
}

async function resolveStoredTool(
  record: StoredToolRecord,
  builtinMap: Map<string, ToolDefinition>,
): Promise<ToolDefinition | null> {
  if (record.handlerType === "builtin") {
    return builtinMap.get(record.name) ?? null;
  }

  if (record.handlerType === "bash") {
    return SERVER_TOOLS.get(record.name) ?? null;
  }

  if (record.handlerType === "javascript") {
    return loadJavascriptTool(record);
  }

  return null;
}
