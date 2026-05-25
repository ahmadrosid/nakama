import type { ToolCall, ToolDefinition } from "@tinyclaw/core";

export function findTool(
  tools: ToolDefinition[],
  name: string,
): ToolDefinition | undefined {
  return tools.find((tool) => tool.name === name);
}

export async function executeToolCall(
  tools: ToolDefinition[],
  call: ToolCall,
  context: ToolContext = {},
): Promise<unknown> {
  const tool = findTool(tools, call.name);

  if (!tool) {
    return { error: `Unknown tool: ${call.name}` };
  }

  try {
    return await tool.run(call.arguments, context);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function serializeToolResult(result: unknown): string {
  return JSON.stringify(result);
}
