import type { StreamEvent, ToolContext, ToolDefinition } from "@nakama/core";
import { z } from "zod";
import { streamMessage } from "../http/shared";
import type { AgentService } from "../services/agent-service";
import { sessionTurnRegistry } from "../services/session-turn-registry";
import { formatToolActivityLabel } from "./sub-agent-activity";
import {
  buildSubAgentPrompt,
  buildSubAgentResult,
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
      "Delegate work to a same-profile sub-agent (research, review, planning, debugging). Each run happens in its own chat under this one, shown in Recents, so the user can open and continue it. By default the call waits and returns status, summary, output, and the chat's sessionId for you to synthesize; several can run in parallel. Set background=true whenever the user asks for separate or new chats, or for work they will open later: the call returns the sessionId at once without waiting. Sub-agents cannot nest sub-agents. For repo coding work, use bash with coding-agent instead.",
    name: SUB_AGENT_TOOL_NAME,
    parallelSafe: true,
    parameters: {
      additionalProperties: false,
      properties: {
        background: {
          description:
            "Return at once instead of waiting for the answer. Up to 5 sub-agent chats per chat. Read the reply later with read_profile_session.",
          type: "boolean",
        },
        context: {
          description: "Optional scoped background the sub-agent should know.",
          type: "string",
        },
        sessionId: {
          description:
            "Send the task to a sub-agent chat this one started earlier, instead of a new chat.",
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
  const timeoutMs = readTimeoutMs(input.timeoutMs ?? null);

  try {
    // Automation turns have no chat to hang a child under, and a cognito chat
    // must leave no chats behind, so both keep the in-memory run.
    if (
      !context.sessionId ||
      agentService.isCognitoSession(context.sessionId)
    ) {
      if (input.background || input.sessionId) {
        return failSubAgentResult("Separate chats need a saved chat session.");
      }

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
    }

    return await runInChildSession(
      {
        background: input.background === true,
        childSessionId: input.sessionId?.trim(),
        parentSessionId: context.sessionId,
        prompt: buildSubAgentPrompt(task, scopedContext),
        task,
        timeoutMs,
      },
      { ...context, orgId },
      agentService
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return failSubAgentResult(message);
  }
}

interface ChildRun {
  background: boolean;
  childSessionId?: string;
  parentSessionId: string;
  prompt: string;
  task: string;
  timeoutMs: number;
}

/** Runs the task as a chat under the parent, so the user can open and continue it. */
async function runInChildSession(
  run: ChildRun,
  context: ToolContext & { orgId: string },
  agentService: AgentService
): Promise<SubAgentToolOutput> {
  const parent = await agentService.getSessionSummary(
    run.parentSessionId,
    context.orgId
  );

  // A branch has a parent too, but it also has the message it branched at.
  if (parent?.parentSessionId && parent.branchMessageIndex === null) {
    return failSubAgentResult("Nested sub-agent execution is not allowed.");
  }

  let sessionId = run.childSessionId;

  if (sessionId) {
    const child = await agentService.getSessionSummary(
      sessionId,
      context.orgId
    );

    if (child?.parentSessionId !== run.parentSessionId) {
      return failSubAgentResult(
        `Session ${sessionId} was not started from this chat.`
      );
    }
  } else {
    sessionId = await agentService.createChildSession(
      run.parentSessionId,
      context.orgId,
      run.task.slice(0, 80),
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
  const activity = run.background ? null : followActivity(childId, context);
  const startedAt = Date.now();

  const terminal = new Promise<StreamEvent>((resolve) => {
    // Nothing reads this stream. The turn runs anyway and publishes to the
    // turn registry, which is what a browser tab opening the chat follows.
    void streamMessage(
      childId,
      session,
      { clientOrigin: context.clientOrigin, message: run.prompt },
      (event) => {
        agentService.scheduleSessionTitleGeneration(childId);
        resolve(event);
      },
      // Stop on the parent also stops a child it is waiting for. A background
      // child outlives the parent turn on purpose.
      run.background ? undefined : context.signal,
      run.timeoutMs
    )
      .body?.pipeTo(new WritableStream())
      .catch(() => {
        // The turn already reported its end through onComplete.
      });
  });

  if (run.background) {
    const output = `Started in a new chat (session ${childId}). The user can open it from Recents. Do not wait for it; read its reply later with read_profile_session.`;

    return { output, sessionId: childId, status: "success", summary: output };
  }

  const event = await terminal.finally(() => activity?.unsubscribe());

  if (event.type === "done") {
    return {
      ...buildSubAgentResult("success", event.reply),
      sessionId: childId,
    };
  }

  // The turn's own deadline fires at timeoutMs, so an earlier error is a failure.
  if (Date.now() - startedAt >= run.timeoutMs) {
    return {
      ...buildSubAgentResult("timeout", "", "Sub-agent timed out."),
      sessionId: childId,
    };
  }

  return {
    ...buildSubAgentResult(
      "fail",
      "",
      event.type === "error" ? event.error : "Sub-agent failed."
    ),
    sessionId: childId,
  };
}

/** Feeds the parent's sub-agent row the same live labels the in-memory run gave it. */
function followActivity(sessionId: string, context: ToolContext) {
  let writing = false;
  let planning = false;

  context.emitSubAgentActivity?.("Starting…");

  return sessionTurnRegistry.subscribe(sessionId, (event) => {
    if (event.type === "tool_start") {
      context.emitSubAgentActivity?.(
        formatToolActivityLabel(event.tool, event.input)
      );
    } else if (event.type === "thinking" && !planning) {
      planning = true;
      context.emitSubAgentActivity?.("Planning…");
    } else if (event.type === "chunk" && !writing) {
      writing = true;
      context.emitSubAgentActivity?.("Writing answer…");
    }
  });
}

function readTimeoutMs(value: number | null): number {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SUB_AGENT_TIMEOUT_MS;
  }

  return Math.min(Math.floor(value), MAX_SUB_AGENT_TIMEOUT_MS);
}
