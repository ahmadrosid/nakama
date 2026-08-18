import type { ToolContext, ToolDefinition } from "@nakama/core";
import type { AgentService } from "../services/agent-service";
import {
  DEFAULT_SUB_AGENT_TIMEOUT_MS,
  failSubAgentResult,
  MAX_SUB_AGENT_TIMEOUT_MS,
  type SubAgentRunResult,
} from "./sub-agent-shared";

export const SUB_AGENT_TOOL_NAME = "sub_agent";

export interface SubAgentToolInput {
  context?: string;
  task: string;
  timeoutMs?: number;
}

export type SubAgentToolOutput = SubAgentRunResult;

export function createSubAgentTool(agentService: AgentService): ToolDefinition {
  return {
    description:
      "Delegate focused work to a same-profile sub-agent (research, review, planning, debugging). Provide a clear task and optional context. Returns status, summary, and output for you to synthesize for the user. The parent may launch multiple sub-agents in parallel for independent tasks. Sub-agents cannot nest sub-agents. For repo coding work, use bash with coding-agent instead.",
    name: SUB_AGENT_TOOL_NAME,
    parallelSafe: true,
    parameters: {
      additionalProperties: false,
      properties: {
        context: {
          description: "Optional scoped background the sub-agent should know.",
          type: "string",
        },
        task: {
          description: "Clear instruction for the sub-agent to complete.",
          type: "string",
        },
        timeoutMs: {
          description:
            "Timeout in milliseconds. Defaults to 300000 (5 minutes), max 600000 (10 minutes). Counts toward the parent web stream budget when streaming.",
          type: "number",
        },
      },
      required: ["task"],
      type: "object",
    },
    async run(input, context) {
      return runSubAgentTool(input, context, agentService);
    },
  };
}

export async function runSubAgentTool(
  input: unknown,
  context: ToolContext,
  agentService: AgentService
): Promise<SubAgentToolOutput> {
  const depth = context.agentDepth ?? 0;

  if (!Number.isInteger(depth) || depth < 0) {
    return failSubAgentResult("agentDepth must be a non-negative integer.");
  }

  if (depth >= 1) {
    return failSubAgentResult("Nested sub-agent execution is not allowed.");
  }

  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();

  if (!(orgId && profileId)) {
    return failSubAgentResult("orgId and profileId are required.");
  }

  const task = readString(input, "task")?.trim();

  if (!task) {
    return failSubAgentResult("task is required.");
  }

  const scopedContext = readString(input, "context")?.trim();
  const timeoutMs = readTimeoutMs(readOptionalNumber(input, "timeoutMs"));

  try {
    return await agentService.runSubAgentPrompt({
      agentDepth: depth + 1,
      clientOrigin: context.clientOrigin,
      context: scopedContext,
      onActivity: context.emitSubAgentActivity,
      orgId,
      profileId,
      sessionId: context.sessionId,
      task,
      timeoutMs,
      userId: context.userId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failSubAgentResult(message);
  }
}

function readTimeoutMs(value: number | null): number {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SUB_AGENT_TIMEOUT_MS;
  }

  return Math.min(Math.floor(value), MAX_SUB_AGENT_TIMEOUT_MS);
}

function readString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function readOptionalNumber(input: unknown, key: string): number | null {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
