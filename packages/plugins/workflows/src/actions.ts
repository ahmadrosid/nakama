import type {
  CreateWorkflowRequest,
  PluginExecutionContext,
  StoredWorkflow,
  UpdateWorkflowRequest,
  WorkflowRunRecord,
} from "@nakama/core";
import {
  buildReceiptBag,
  parseWorkflowRecord,
  parseWorkflowValue,
  validateWorkflowSteps,
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
  stepId?: string;
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

    if (context.actionKey === "test_step") {
      const started = Date.now();

      // Errors come back as data: the host hides thrown messages from the UI.
      try {
        const steps = input.steps ?? [];
        const index = steps.findIndex((entry) => entry.id === input.stepId);
        const step = steps[index];

        if (!step || step.kind === "summarize") {
          throw new Error("Choose a tool, compare, assert, or template step.");
        }

        // Only this step's tool must be available now; earlier steps may use a
        // disconnected tool, because their results come from the last run.
        const earlier = steps.slice(0, index);
        const tools = await host({ agentId, op: "tools" });

        validateWorkflowSteps(
          [
            ...earlier,
            step,
            { id: "__try_summary", kind: "summarize", prompt: "-" },
          ],
          new Set([
            ...tools.map((tool) => tool.name),
            ...earlier.flatMap((entry) =>
              entry.kind === "tool" ? [entry.tool] : []
            ),
          ])
        );

        // The step reads the last run's results, so references to earlier steps resolve.
        const [latest] = existing ? await service.listRuns(existing.id) : [];

        const outputs = Object.fromEntries(
          (latest?.steps ?? [])
            .filter((receipt) => receipt.status === "completed")
            .map((receipt) => [
              receipt.stepId,
              parseWorkflowValue(receipt.output),
            ])
        );

        const result = await runner.executeDataStep(
          step,
          buildReceiptBag(
            input.input ?? parseWorkflowRecord(latest?.input ?? {}),
            outputs
          ),
          {
            profileId: agentId,
            runId: `test_${crypto.randomUUID()}`,
            workflowId: existing?.id ?? "draft",
          }
        );

        return { ...result, durationMs: Date.now() - started };
      } catch (error) {
        return {
          durationMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        };
      }
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
