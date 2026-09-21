import type {
  CreateWorkflowRequest,
  PluginExecutionContext,
  StoredWorkflow,
  UpdateWorkflowRequest,
  WorkflowRunRecord,
} from "@nakama/core";
import { WorkflowRunner } from "./workflow-runner";
import { WorkflowService } from "./workflow-service";

type Context = PluginExecutionContext & {
  actionKey: string;
  host(request: Record<string, unknown>): Promise<unknown>;
};
type Input = {
  table?: string;
  workflowId?: string;
  runId?: string;
  agentId?: string;
  input?: Record<string, unknown>;
} & Partial<CreateWorkflowRequest>;

export async function run(input: Input, context: Context): Promise<unknown> {
  if (!context.databasePath) {
    throw new Error("Workflow database is unavailable.");
  }
  const service = new WorkflowService(context.databasePath, context.orgId);
  const host = context.host;
  try {
    if (context.actionKey === "database") {
      return host({ op: "workflow_database", table: input.table });
    }
    if (context.actionKey === "profiles") {
      return host({ op: "profiles" });
    }
    if (context.actionKey === "import_legacy") {
      const legacy = (await host({ op: "legacy_workflows" })) as Array<{
        workflow: StoredWorkflow;
        runs: WorkflowRunRecord[];
      }>;
      return service.importLegacy(legacy);
    }
    if (context.actionKey === "list_workflows") {
      return service.listForOrg();
    }
    const existing = input.workflowId
      ? await service.get(input.workflowId)
      : null;
    if (input.workflowId && !existing) {
      throw new Error("Workflow not found.");
    }
    if (context.actionKey === "get_workflow") {
      return existing;
    }
    if (context.actionKey === "runs") {
      return service.listRuns(input.workflowId!);
    }
    if (context.actionKey === "get_run") {
      return service.getRun(input.workflowId!, input.runId!);
    }
    if (context.actionKey === "delete_run") {
      return {
        deleted: await service.deleteRun(input.workflowId!, input.runId!),
      };
    }
    if (context.actionKey === "delete_workflow") {
      return { deleted: await service.delete(input.workflowId!) };
    }
    const profileId = input.agentId || existing?.profileId || context.profileId;
    const profiles = (await host({ op: "profiles" })) as Array<{
      id: string;
      isDefault?: boolean;
    }>;
    const agentId =
      profileId || profiles.find((profile) => profile.isDefault)?.id;
    if (!(agentId && profiles.some((profile) => profile.id === agentId))) {
      throw new Error("Profile not found.");
    }
    if (context.actionKey === "tools") {
      return host({ agentId, op: "tools" });
    }
    if (
      context.actionKey === "create_workflow" ||
      context.actionKey === "update_workflow"
    ) {
      const tools = (await host({ agentId, op: "tools" })) as Array<{
        name: string;
      }>;
      const allowed = new Set(tools.map((tool) => tool.name));
      const changes: UpdateWorkflowRequest = { profileId: agentId };
      for (const key of ["name", "description", "steps", "enabled"] as const) {
        if (input[key] !== undefined) {
          Object.assign(changes, { [key]: input[key] });
        }
      }
      return context.actionKey === "create_workflow"
        ? await service.create(
            changes as CreateWorkflowRequest,
            agentId,
            allowed
          )
        : await service.update(input.workflowId!, changes, allowed);
    }
    if (context.actionKey === "run_workflow") {
      const runner = new WorkflowRunner(service, {
        executeTool: (id, name, args, runId, workflowId) =>
          host({
            agentId: id,
            input: args,
            name,
            op: "execute_tool",
            runId,
            workflowId,
          }),
        runWorkflowSummarize: async (_org, id, prompt, bag) =>
          (await host({ agentId: id, bag, op: "summarize", prompt })) as string,
      });
      const result = await runner.run(input.workflowId!, input.input ?? {});
      if (result.skipped) {
        throw new Error(result.error ?? "Workflow run skipped.");
      }
      const completed = await service.getRun(input.workflowId!, result.runId!);
      return {
        ...result,
        name: existing!.name,
        run: completed,
        status: result.error ? "failed" : "completed",
        workflowId: existing!.id,
      };
    }
    throw new Error("Unknown workflow action.");
  } finally {
    service.close();
  }
}
