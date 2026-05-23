import type { ToolDefinition } from "../contract";

export function createToolRegistry(
  tools: ToolDefinition[],
): Map<string, ToolDefinition<unknown, unknown>> {
  const registry = new Map<string, ToolDefinition<unknown, unknown>>();

  for (const tool of tools) {
    registry.set(tool.name, tool as ToolDefinition<unknown, unknown>);
  }

  return registry;
}
