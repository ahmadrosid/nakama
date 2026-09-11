import { executeToolCall } from "@nakama/agent";
import type { PluginExecutionContext, WorkflowRunRecord } from "@nakama/core";
import { inspectWorkflowSqlite } from "@nakama/core";
import { type DatabaseAdapter, DatabaseWorkflowStore } from "@nakama/db";
import type { AgentService } from "./agent-service";

export function createPluginAgentHost(
  db: DatabaseAdapter,
  agent: AgentService
) {
  return async (
    value: unknown,
    context: PluginExecutionContext,
    signal?: AbortSignal
  ): Promise<unknown> => {
    signal?.throwIfAborted();
    if (context.actor.role === "viewer") {
      throw new Error("Forbidden");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid host request.");
    }
    const request = value as Record<string, unknown>;
    const { orgId } = context;
    if (request.op === "workflow_database") {
      if (context.pluginId !== "workflows") {
        throw new Error("Forbidden");
      }
      return inspectWorkflowSqlite(
        orgId,
        typeof request.table === "string" ? { table: request.table } : {}
      );
    }
    if (request.op === "profiles") {
      const { profiles } = await agent.listProfiles(orgId);
      return profiles.filter(
        (profile) => !profile.isSuper || context.actor.role === "admin"
      );
    }
    if (request.op === "legacy_workflows") {
      if (context.actor.role !== "admin" || context.pluginId !== "workflows") {
        throw new Error("Forbidden");
      }
      const workflows = await new DatabaseWorkflowStore(db).listForOrg(orgId);
      return Promise.all(
        workflows.map(async (workflow) => {
          const runs = await db.listWorkflowRuns(workflow.id, 1_000_000);
          return {
            runs: await Promise.all(
              runs.map(async (run) => ({
                ...run,
                input: parseJson(run.input) as WorkflowRunRecord["input"],
                steps: (await db.listWorkflowRunSteps(run.id)).map((step) => ({
                  ...step,
                  input: parseJson(step.input),
                  output: parseJson(step.output),
                })),
              }))
            ),
            workflow,
          };
        })
      );
    }
    const profileId =
      typeof request.agentId === "string" ? request.agentId.trim() : "";
    const profile = profileId
      ? await db.getProfileForOrg(profileId, orgId)
      : null;
    if (!profile || (profile.isSuper && context.actor.role !== "admin")) {
      throw new Error("Profile not found.");
    }
    if (request.op === "summarize") {
      if (typeof request.prompt !== "string" || !isRecord(request.bag)) {
        throw new Error("Invalid summary request.");
      }
      return agent.runPluginSummarize(
        orgId,
        profileId,
        request.prompt,
        request.bag,
        signal
      );
    }
    const tools = (
      await agent.resolvePluginExecutionTools(orgId, profileId)
    ).filter((tool) => !tool.name.startsWith("plugin_"));
    if (request.op === "tools") {
      return tools.map(({ name, description, parameters }) => ({
        description,
        name,
        parameters,
      }));
    }
    if (request.op === "execute_tool") {
      if (typeof request.name !== "string" || !isRecord(request.input)) {
        throw new Error("Invalid tool request.");
      }
      return executeToolCall(
        tools,
        {
          arguments: request.input,
          id: crypto.randomUUID(),
          name: request.name,
        },
        {
          ...agent.buildPluginToolContext(orgId, {
            profileId,
            runId:
              typeof request.runId === "string"
                ? request.runId
                : context.invocationId,
            workflowId:
              typeof request.workflowId === "string"
                ? request.workflowId
                : context.pluginId,
          }),
          orgRole: context.actor.role,
          signal,
        }
      );
    }
    throw new Error("Unknown host operation.");
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function parseJson(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
