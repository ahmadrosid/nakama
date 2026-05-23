import type { ToolDefinition } from "@tinyclaw/core";
import type { AutomationDefinition } from "@tinyclaw/core";

export interface AutomationExecutionResult {
  automationId: string;
  completedSteps: number;
}

export class AutomationExecutor {
  constructor(
    private readonly tools: Map<string, ToolDefinition<unknown, unknown>>,
  ) {}

  async run(
    definition: AutomationDefinition,
  ): Promise<AutomationExecutionResult> {
    for (const step of definition.steps) {
      const tool = this.tools.get(step.tool);

      if (!tool) {
        throw new Error(`Missing tool: ${step.tool}`);
      }

      await tool.run(step.input, { automationId: definition.id });
    }

    return {
      automationId: definition.id,
      completedSteps: definition.steps.length,
    };
  }
}
