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
  description:
    "Search the web for current information. Requires an OpenAI or Anthropic provider; search runs natively on the provider with citations.",
  name: WEB_SEARCH_TOOL_NAME,
  parallelSafe: true,
  parameters: jsonSchemaFromZod(webSearchInputSchema),
  async run() {
    throw new Error(
      "web_search runs on the configured OpenAI or Anthropic provider and cannot be executed locally."
    );
  },
};

export interface PartitionedTools {
  hasWebSearch: boolean;
  localTools: ToolDefinition[];
}

export function partitionTools(tools: ToolDefinition[]): PartitionedTools {
  const localTools = tools.filter((tool) => tool.name !== WEB_SEARCH_TOOL_NAME);

  return {
    hasWebSearch: tools.some((tool) => tool.name === WEB_SEARCH_TOOL_NAME),
    localTools,
  };
}
