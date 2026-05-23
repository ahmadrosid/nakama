import type { JsonSchema, LlmToolDefinition, ToolDefinition } from "../contract";

export function emptyObjectSchema(): JsonSchema {
  return {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
}

export function permissiveObjectSchema(): JsonSchema {
  return {
    type: "object",
    additionalProperties: true,
  };
}

export function toLlmToolDefinition(tool: ToolDefinition): LlmToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters ?? emptyObjectSchema(),
  };
}

export function toLlmToolDefinitions(tools: ToolDefinition[]): LlmToolDefinition[] {
  return tools.map(toLlmToolDefinition);
}
