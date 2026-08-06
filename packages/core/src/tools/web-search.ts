import { z } from "zod";
import type { ToolDefinition } from "../contract";
import { jsonSchemaFromZod, requiredTrimmedString } from "./schema";

export const WEB_SEARCH_TOOL_NAME = "web_search";

export const webSearchInputSchema = z
  .object({
    query: requiredTrimmedString("query"),
  })
  .strict();

export type WebSearchInput = z.infer<typeof webSearchInputSchema>;

export const webSearchTool: ToolDefinition<WebSearchInput> = {
  name: WEB_SEARCH_TOOL_NAME,
  description:
    "Search the web for current information. Requires an OpenAI or Anthropic provider; search runs natively on the provider with citations.",
  parameters: jsonSchemaFromZod(webSearchInputSchema),
  parallelSafe: true,
  async run() {
    throw new Error(
      "web_search runs on the configured OpenAI or Anthropic provider and cannot be executed locally.",
    );
  },
};

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
