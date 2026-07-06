import type { ToolDefinition } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import { runCodingAgentTask, type DelegateCodingTaskInput, type DelegateCodingTaskResult } from "../services/coding-agent-runner";

export function createDelegateCodingTaskTool(
  db: DatabaseAdapter,
): ToolDefinition<DelegateCodingTaskInput, DelegateCodingTaskResult> {
  return {
    name: "delegate_coding_task",
    description:
      "Delegate a coding task to an installed headless coding agent like Codex, Claude Code, or OpenCode, then return its result.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The concrete coding task to delegate.",
        },
        backend: {
          type: "string",
          enum: ["codex", "claude_code", "opencode"],
          description:
            "Optional coding agent backend to force. Defaults to the selected or first installed harness.",
        },
        cwd: {
          type: "string",
          description: "Optional working directory inside the active profile workspace.",
        },
        timeoutMs: {
          type: "number",
          description: "Optional timeout in milliseconds. Defaults to 10 minutes, max 30 minutes.",
        },
      },
      required: ["task"],
      additionalProperties: false,
    },
    async run(input, context) {
      return runCodingAgentTask(db, input, context);
    },
  };
}
