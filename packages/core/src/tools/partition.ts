import type { ToolDefinition } from "../contract";
import { WEB_SEARCH_TOOL_NAME } from "./web-search";

export interface PartitionedTools {
  localTools: ToolDefinition[];
  hasWebSearch: boolean;
}

export function partitionTools(tools: ToolDefinition[]): PartitionedTools {
  const localTools = tools.filter((tool) => tool.name !== WEB_SEARCH_TOOL_NAME);

  return {
    localTools,
    hasWebSearch: tools.some((tool) => tool.name === WEB_SEARCH_TOOL_NAME),
  };
}
