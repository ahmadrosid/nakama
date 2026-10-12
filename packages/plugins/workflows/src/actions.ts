import type {
  CreateWorkflowRequest,
  PluginExecutionContext,
  StoredWorkflow,
  UpdateWorkflowRequest,
  WorkflowRunRecord,
} from "@nakama/core";
import {
  parseWorkflowValue,
  type WorkflowBag,
  type WorkflowRecord,
  type WorkflowValue,
} from "./workflow-ops";
import { WorkflowRunner } from "./workflow-runner";
import { WorkflowService } from "./workflow-service";

type Context = PluginExecutionContext & {
  actionKey: string;
  host: WorkflowHostCall;
};

type Input = {
  table?: string;
  workflowId?: string;
  runId?: string;
  agentId?: string;
  input?: WorkflowRecord;
} & Partial<CreateWorkflowRequest>;

type Profile = { id: string; isDefault?: boolean };

type Tool = { name: string };

type LegacyWorkflow = { workflow: StoredWorkflow; runs: WorkflowRunRecord[] };

type WorkflowHostRequest =
  | { op: "workflow_database"; table?: string }
  | { op: "profiles" }
  | { op: "legacy_workflows" }
  | { agentId: string; op: "tools" }
  | {
      agentId: string;
      input: WorkflowRecord;
      name: string;
      op: "execute_tool";
      runId: string;
      workflowId: string;
    }
  | {
      agentId: string;
      bag: WorkflowBag;
      op: "summarize";
      prompt: string;
    };

type WorkflowHostResponse<Request extends WorkflowHostRequest> =
  Request extends { op: "workflow_database" }
    ? WorkflowValue
    : Request extends { op: "profiles" }
      ? Profile[]
      : Request extends { op: "legacy_workflows" }
        ? LegacyWorkflow[]
        : Request extends { op: "tools" }
          ? Tool[]
          : Request extends { op: "execute_tool" }
            ? WorkflowValue
            : Request extends { op: "summarize" }
              ? string
              : never;

type WorkflowHostCall = <Request extends WorkflowHostRequest>(
  request: Request
) => Promise<WorkflowHostResponse<Request>>;

export async function run(
  input: Input,
  context: Context
): Promise<WorkflowValue> {
  if (!context.databasePath) {
    throw new Error("Workflow database is unavailable.");
  }

  const service = new WorkflowService(context.databasePath, context.orgId);
  const host = context.host;

  try {
    if (context.actionKey === "database") {
      return input.table
        ? host({ op: "workflow_database", table: input.table })
        : host({ op: "workflow_database" });
    }

    if (context.actionKey === "profiles") {
      return host({ op: "profiles" });
    }

    if (context.actionKey === "import_legacy") {
      const legacy = await host({ op: "legacy_workflows" });

      return parseWorkflowValue(await service.importLegacy(legacy));
    }

    if (context.actionKey === "list_workflows") {
      return parseWorkflowValue(await service.listForOrg());
    }

    const existing = input.workflowId
      ? await service.get(input.workflowId)
      : null;

    if (input.workflowId && !existing) {
      throw new Error("Workflow not found.");
    }

    if (context.actionKey === "get_workflow") {
      return parseWorkflowValue(existing);
    }

    if (context.actionKey === "runs") {
      return parseWorkflowValue(await service.listRuns(input.workflowId!));
    }

    if (context.actionKey === "get_run") {
      return parseWorkflowValue(
        await service.getRun(input.workflowId!, input.runId!)
      );
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

    const profiles = await host({ op: "profiles" });

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
      const tools = await host({ agentId, op: "tools" });

      const allowed = new Set(tools.map((tool) => tool.name));
      const changes: UpdateWorkflowRequest = { profileId: agentId };

      for (const key of ["name", "description", "steps", "enabled"] as const) {
        if (input[key] !== undefined) {
          Object.assign(changes, { [key]: input[key] });
        }
      }

      if (context.actionKey === "create_workflow") {
        if (!(changes.name && changes.steps)) {
          throw new Error("Workflow name and steps are required.");
        }

        const request: CreateWorkflowRequest = {
          ...changes,
          description: changes.description ?? changes.name,
          name: changes.name,
          steps: changes.steps,
        };

        return parseWorkflowValue(
          await service.create(request, agentId, allowed)
        );
      }

      return parseWorkflowValue(
        await service.update(input.workflowId!, changes, allowed)
      );
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
          host({ agentId: id, bag, op: "summarize", prompt }),
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
