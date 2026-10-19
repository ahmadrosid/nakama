import { executeToolCall } from "@nakama/agent";
import type { PluginExecutionContext } from "@nakama/core";
import { inspectWorkflowSqlite } from "@nakama/core";
import { type DatabaseAdapter, DatabaseWorkflowStore } from "@nakama/db";
import { z } from "zod";
import type { AgentService } from "./agent-service";
import type { ComposioService } from "./composio-service";

const pluginJsonSchema = z.json();

type PluginJsonValue = z.infer<typeof pluginJsonSchema>;

const hostRequestSchema = z.discriminatedUnion("op", [
  z.object({
    agentId: z.string().optional(),
    op: z.literal("workflow_database"),
    table: z.string().optional(),
  }),
  z.object({ agentId: z.string().optional(), op: z.literal("profiles") }),
  z.object({
    agentId: z.string().optional(),
    op: z.literal("legacy_workflows"),
  }),
  z.object({
    agentId: z.string(),
    bag: z.record(z.string(), pluginJsonSchema),
    op: z.literal("summarize"),
    prompt: z.string(),
  }),
  z.object({ agentId: z.string(), op: z.literal("tools") }),
  z.object({
    agentId: z.string(),
    input: z.record(z.string(), pluginJsonSchema),
    name: z.string(),
    op: z.literal("execute_tool"),
    runId: z.string().optional(),
    workflowId: z.string().optional(),
  }),
  z.object({
    action: z.enum(["info", "read", "write"]),
    data: z
      .array(
        z.object({
          range: z.string(),
          values: z.array(z.array(z.string())),
        })
      )
      .max(10_000)
      .optional(),
    op: z.literal("google_sheets"),
    range: z.string().optional(),
    spreadsheetId: z.string().regex(/^[\w-]+$/),
  }),
]);

const GOOGLE_SHEETS_TOOLS = {
  info: "GOOGLESHEETS_GET_SPREADSHEET_INFO",
  read: "GOOGLESHEETS_BATCH_GET",
  write: "GOOGLESHEETS_UPDATE_VALUES_BATCH",
};

export function createPluginAgentHost(
  db: DatabaseAdapter,
  agent: AgentService,
  composio?: Pick<ComposioService, "executeGoogleSheetsTool">
) {
  return async (
    value: PluginJsonValue,
    context: PluginExecutionContext,
    signal?: AbortSignal
  ): Promise<PluginJsonValue> => {
    signal?.throwIfAborted();

    if (context.actor.role !== "admin" && context.actor.role !== "member") {
      throw new Error("Forbidden");
    }

    const request = hostRequestSchema.parse(value);
    const { orgId } = context;

    if (request.op === "workflow_database") {
      if (context.pluginId !== "workflows") {
        throw new Error("Forbidden");
      }

      return toPluginJson(
        await inspectWorkflowSqlite(
          orgId,
          request.table ? { table: request.table } : {}
        )
      );
    }

    if (request.op === "google_sheets") {
      if (context.pluginId !== "data-view" || !composio) {
        throw new Error("Forbidden");
      }

      const args = {
        info: { spreadsheet_id: request.spreadsheetId },
        read: {
          ranges: [request.range ?? ""],
          spreadsheet_id: request.spreadsheetId,
        },
        write: {
          data: request.data ?? [],
          spreadsheet_id: request.spreadsheetId,
          valueInputOption: "USER_ENTERED",
        },
      }[request.action];

      // The caller's own Google account does the work, so each member keeps their sheet access.
      return toPluginJson(
        await composio.executeGoogleSheetsTool(
          orgId,
          context.actor.id,
          GOOGLE_SHEETS_TOOLS[request.action],
          args
        )
      );
    }

    if (request.op === "profiles") {
      const { profiles } = await agent.listProfiles(orgId);

      return toPluginJson(
        profiles.filter(
          (profile) => !profile.isSuper || context.actor.role === "admin"
        )
      );
    }

    if (request.op === "legacy_workflows") {
      if (context.actor.role !== "admin" || context.pluginId !== "workflows") {
        throw new Error("Forbidden");
      }

      const workflows = await new DatabaseWorkflowStore(db).listForOrg(orgId);

      return toPluginJson(
        await Promise.all(
          workflows.map(async (workflow) => {
            const runs = await db.listWorkflowRuns(workflow.id, 1_000_000);

            return {
              runs: await Promise.all(
                runs.map(async (run) => ({
                  ...run,
                  input: parseJson(run.input),
                  steps: (await db.listWorkflowRunSteps(run.id)).map(
                    (step) => ({
                      ...step,
                      input: parseJson(step.input),
                      output: parseJson(step.output),
                    })
                  ),
                }))
              ),
              workflow,
            };
          })
        )
      );
    }

    const profileId = request.agentId.trim();
    const profile = await db.getProfileForOrg(profileId, orgId);

    if (!profile || (profile.isSuper && context.actor.role !== "admin")) {
      throw new Error("Profile not found.");
    }

    if (request.op === "summarize") {
      return toPluginJson(
        await agent.runPluginSummarize(
          orgId,
          profileId,
          request.prompt,
          request.bag,
          signal
        )
      );
    }

    // Assigned plugin tools are valid workflow steps; workflow tools would recurse.
    const tools = (
      await agent.resolvePluginExecutionTools(orgId, profileId)
    ).filter((tool) => !tool.name.startsWith("plugin_workflows__"));

    if (request.op === "tools") {
      return toPluginJson(
        tools.map(({ name, description, parameters }) => ({
          description,
          name,
          parameters,
        }))
      );
    }

    return toPluginJson(
      await executeToolCall(
        tools,
        {
          arguments: request.input,
          id: crypto.randomUUID(),
          name: request.name,
        },
        {
          ...agent.buildPluginToolContext(orgId, {
            profileId,
            runId: request.runId ?? context.invocationId,
            workflowId: request.workflowId ?? context.pluginId,
          }),
          orgRole: context.actor.role,
          signal,
        }
      )
    );
  };
}

function toPluginJson<T>(value: T): PluginJsonValue {
  return pluginJsonSchema.parse(value);
}

function parseJson(value: string | null): PluginJsonValue {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);

    return pluginJsonSchema.parse(parsed);
  } catch {
    return value;
  }
}
