import type { ToolCall, ToolContext, ToolDefinition } from "@nakama/core";
import * as core from "@nakama/core";

export function canRunToolCallsInParallel(
  tools: ToolDefinition[],
  toolCalls: ToolCall[]
): boolean {
  if (toolCalls.length <= 1) {
    return false;
  }

  return toolCalls.every(
    (call) =>
      tools.find((tool) => tool.name === call.name)?.parallelSafe === true
  );
}

export async function executeToolCall(
  tools: ToolDefinition[],
  call: ToolCall,
  context: ToolContext = {}
): Promise<unknown> {
  const tool = tools.find((item) => item.name === call.name);

  if (!tool) {
    return { error: `Unknown tool: ${call.name}` };
  }

  try {
    const result = await tool.run(call.arguments, context);
    // The single place every tool result passes through, so the optimiser is
    // wired once rather than per tool. It returns `result` untouched unless it
    // is enabled, recognises the tool, and produces something strictly shorter.
    try {
      return await core.distillToolResult(call.name, result, context);
    } catch (error) {
      // Distillation is best-effort: never replace a successful tool result with
      // an optimiser failure (same shape as a tool-runtime error).
      console.warn(
        `distillToolResult failed for ${call.name}; returning raw result:`,
        error instanceof Error ? error.message : error
      );
      return result;
    }
  } catch (error) {
    context.signal?.throwIfAborted();
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
