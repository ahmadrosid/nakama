import type { ToolDefinition } from "../contract";

export const WEB_SEARCH_TOOL_NAME = "web_search";

export const webSearchTool: ToolDefinition = {
  name: WEB_SEARCH_TOOL_NAME,
  description:
    "Search the web for current information. Requires an OpenAI or Anthropic provider; search runs natively on the provider with citations.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async run() {
    throw new Error(
      "web_search runs on the configured OpenAI or Anthropic provider and cannot be executed locally.",
    );
  },
};
