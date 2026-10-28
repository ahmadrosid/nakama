import type { ToolContext, ToolDefinition } from "@nakama/core";
import { z } from "zod";
import { streamMessage } from "../http/shared";
import type { AgentService } from "../services/agent-service";
import { sessionTurnRegistry } from "../services/session-turn-registry";
import {
  buildSubAgentPrompt,
  DEFAULT_SUB_AGENT_TIMEOUT_MS,
  failSubAgentResult,
  MAX_SUB_AGENT_TIMEOUT_MS,
  type SubAgentRunResult,
} from "./sub-agent-shared";

export const SUB_AGENT_TOOL_NAME = "sub_agent";

export type SubAgentToolOutput = SubAgentRunResult & { sessionId?: string };

const SubAgentInputSchema = z.object({
  background: z.boolean().optional().catch(undefined),
  context: z.string().optional().catch(undefined),
  sessionId: z.string().optional().catch(undefined),
  task: z.string().optional().catch(undefined),
  timeoutMs: z.number().optional().catch(undefined),
});

export function createSubAgentTool(agentService: AgentService): ToolDefinition {
  return {
    description:
      "Delegate work to a same-profile sub-agent. Two modes. Default: runs a focused task (research, review, planning, debugging) and returns status, summary, and output for you to synthesize; several can run in parallel. background=true: use it whenever the user asks for separate or new chats, or for work they will open later. Each task starts in its own chat under this one, shown in Recents, and the call returns its session id at once without waiting. Sub-agents cannot nest sub-agents. For repo coding work, use bash with coding-agent instead.",
    name: SUB_AGENT_TOOL_NAME,
    parallelSafe: true,
    parameters: {
      additionalProperties: false,
      properties: {
        background: {
          description:
            "Start the task in a new chat under this one and return at once, instead of waiting for the answer. Up to 5 per chat. The user opens it from Recents; read its reply later with read_profile_session.",
          type: "boolean",
        },
        context: {
          description: "Optional scoped background the sub-agent should know.",
          type: "string",
        },
        sessionId: {
          description:
            "With background: send the task to a chat this one started earlier, instead of a new chat.",
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
      const parsedInput = SubAgentInputSchema.parse(input);

      return runSubAgentTool(parsedInput, context, agentService);
    },
  };
}

export async function runSubAgentTool(
  input: z.infer<typeof SubAgentInputSchema>,
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

  const task = input.task?.trim();

  if (!task) {
    return failSubAgentResult("task is required.");
  }

  const scopedContext = input.context?.trim();

  if (input.background) {
    try {
      return await startChildSessionTurn(
        buildSubAgentPrompt(task, scopedContext),
        task,
        input.sessionId?.trim(),
        { ...context, orgId },
        agentService
      );
    } catch (error) {
      return failSubAgentResult(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const timeoutMs = readTimeoutMs(input.timeoutMs ?? null);

  try {
    return await agentService.runSubAgentPrompt({
      agentDepth: depth + 1,
      clientOrigin: context.clientOrigin,
      context: scopedContext,
      onActivity: context.emitSubAgentActivity,
      orgId,
      orgRole: context.orgRole,
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

async function startChildSessionTurn(
  prompt: string,
  task: string,
  childSessionId: string | undefined,
  context: ToolContext & { orgId: string },
  agentService: AgentService
): Promise<SubAgentToolOutput> {
  const parentSessionId = context.sessionId?.trim();

  if (!parentSessionId) {
    return failSubAgentResult("background needs a chat session.");
  }

  let sessionId = childSessionId;

  if (sessionId) {
    const child = await agentService.getSessionSummary(
      sessionId,
      context.orgId
    );

    if (child?.parentSessionId !== parentSessionId) {
      return failSubAgentResult(
        `Session ${sessionId} was not started from this chat.`
      );
    }
  } else {
    sessionId = await agentService.createChildSession(
      parentSessionId,
      context.orgId,
      task.slice(0, 80),
      { isPlatformAdmin: context.isPlatformAdmin, orgRole: context.orgRole }
    );
  }

  const started = await agentService.beginSessionTurn(sessionId, context.orgId);

  if (!started) {
    return failSubAgentResult(
      started === null
        ? `Session ${sessionId} not found.`
        : `Session ${sessionId} is already answering.`
    );
  }

  const session = await agentService.resolveSession(sessionId, context.orgId);

  if (!session) {
    sessionTurnRegistry.cancelTurn(sessionId);

    return failSubAgentResult(`Session ${sessionId} not found.`);
  }

  const childId = sessionId;

  // Nothing reads this stream. The turn runs anyway and publishes to the turn
  // registry, which is what a browser tab opening the chat subscribes to.
  void streamMessage(
    childId,
    session,
    { clientOrigin: context.clientOrigin, message: prompt },
    () => agentService.scheduleSessionTitleGeneration(childId)
  ).body?.pipeTo(new WritableStream());

  const output = `Started in a new chat (session ${childId}). The user can open it from Recents. Do not wait for it; read its reply later with read_profile_session.`;

  return { output, sessionId: childId, status: "success", summary: output };
}

function readTimeoutMs(value: number | null): number {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SUB_AGENT_TIMEOUT_MS;
  }

  return Math.min(Math.floor(value), MAX_SUB_AGENT_TIMEOUT_MS);
}
