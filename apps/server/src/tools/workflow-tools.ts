import {
  emptyObjectSchema,
  type ToolContext,
  type ToolDefinition,
  type WorkflowStep,
} from "@nakama/core";
import type { AgentService } from "../services/agent-service";
import type { WorkflowRunner } from "../services/workflow-runner";
import type { WorkflowService } from "../services/workflow-service";

export function createWorkflowTools(
  workflowService: WorkflowService,
  workflowRunner: WorkflowRunner,
  agentService: AgentService
): ToolDefinition[] {
  return [
    {
      description:
        "Create and save a user-triggered workflow with declared steps (tool, compare, assert, template) and a final summarize step. Confirm the recipe with the user before saving.",
      name: "create_workflow",
      parameters: {
        additionalProperties: false,
        properties: {
          description: {
            description: "One sentence summary of what the workflow does.",
            type: "string",
          },
          name: {
            description: "Short title for the workflow.",
            type: "string",
          },
          profileId: {
            description:
              "Optional org profile id to run as. Omit to use the current chat profile.",
            type: "string",
          },
          steps: {
            description:
              "Ordered workflow steps. Must end with one summarize step.",
            items: { type: "object" },
            type: "array",
          },
        },
        required: ["name", "description", "steps"],
        type: "object",
      },
      async run(input, context) {
        const orgId = requireOrgId(context);
        const name = readString(input, "name");
        const description = readString(input, "description");
        const steps = readSteps(input);
        const requestedProfileId = readString(input, "profileId")?.trim();
        const profileId = requestedProfileId || context.profileId?.trim();

        if (!(name && description && steps)) {
          throw new Error("name, description, and steps are required.");
        }

        if (!profileId) {
          throw new Error(
            "Workflow must be created from an active chat session."
          );
        }

        const allowedTools = await agentService.resolveWorkflowToolNames(
          orgId,
          profileId
        );
        const workflow = await workflowService.create(
          orgId,
          { description, name, steps },
          profileId,
          {
            isPlatformAdmin: context.isPlatformAdmin,
            orgRole: context.orgRole,
          },
          allowedTools
        );

        return summarizeWorkflow(workflow);
      },
    },
    {
      description: "Update a saved workflow recipe.",
      name: "update_workflow",
      parameters: {
        additionalProperties: false,
        properties: {
          description: { type: "string" },
          enabled: { type: "boolean" },
          name: { type: "string" },
          profileId: { type: "string" },
          steps: {
            items: { type: "object" },
            type: "array",
          },
          workflowId: {
            description: "Workflow id to update.",
            type: "string",
          },
        },
        required: ["workflowId"],
        type: "object",
      },
      async run(input, context) {
        const orgId = requireOrgId(context);
        const workflowId = readString(input, "workflowId");
        if (!workflowId) {
          throw new Error("workflowId is required.");
        }

        const existing = await workflowService.get(workflowId, orgId);
        if (!existing) {
          throw new Error("Workflow not found.");
        }

        const profileId =
          readString(input, "profileId")?.trim() || existing.profileId;
        const allowedTools = await agentService.resolveWorkflowToolNames(
          orgId,
          profileId
        );
        const workflow = await workflowService.update(
          workflowId,
          orgId,
          {
            description: readString(input, "description") ?? undefined,
            enabled:
              typeof (input as Record<string, unknown>).enabled === "boolean"
                ? ((input as Record<string, unknown>).enabled as boolean)
                : undefined,
            name: readString(input, "name") ?? undefined,
            profileId: readString(input, "profileId") ?? undefined,
            steps: readSteps(input) ?? undefined,
          },
          {
            isPlatformAdmin: context.isPlatformAdmin,
            orgRole: context.orgRole,
          },
          allowedTools
        );

        return summarizeWorkflow(workflow);
      },
    },
    {
      description: "List saved workflows for the active organization.",
      name: "list_workflows",
      parameters: emptyObjectSchema(),
      async run(_input, context) {
        const orgId = requireOrgId(context);
        const workflows = await workflowService.listForOrg(orgId);
        return workflows.map(summarizeWorkflow);
      },
    },
    {
      description:
        "Run a saved workflow immediately when the user asks to trigger it from chat. Returns the run output, error, and step receipts.",
      name: "run_workflow",
      parameters: {
        additionalProperties: false,
        properties: {
          input: {
            additionalProperties: true,
            description:
              "Optional runtime input bound to {{input.*}} templates in steps.",
            type: "object",
          },
          workflowId: {
            description: "Workflow id to run (use list_workflows to find it).",
            type: "string",
          },
        },
        required: ["workflowId"],
        type: "object",
      },
      async run(input, context) {
        const orgId = requireOrgId(context);
        const workflowId = readString(input, "workflowId");
        if (!workflowId) {
          throw new Error("workflowId is required.");
        }

        const workflow = await workflowService.get(workflowId, orgId);
        if (!workflow) {
          throw new Error("Workflow not found.");
        }

        const runtimeInput = readObject(input, "input") ?? {};
        const result = await workflowRunner.run(workflowId, runtimeInput);

        if (result.skipped) {
          throw new Error(result.error ?? "Workflow run skipped.");
        }

        const runs = await workflowService.listRuns(workflowId, orgId, 1);
        const run = runs[0];

        if (result.error) {
          return {
            error: result.error,
            name: workflow.name,
            output: null,
            run,
            status: "failed" as const,
            workflowId,
          };
        }

        return {
          error: null,
          name: workflow.name,
          output: result.output ?? null,
          run,
          status: "completed" as const,
          workflowId,
        };
      },
    },
  ];
}

function summarizeWorkflow(workflow: {
  description: string;
  enabled: boolean;
  id: string;
  lastRunAt?: string | null;
  name: string;
  profileId: string;
  steps: WorkflowStep[];
}) {
  return {
    description: workflow.description,
    enabled: workflow.enabled,
    id: workflow.id,
    lastRunAt: workflow.lastRunAt ?? null,
    name: workflow.name,
    profileId: workflow.profileId,
    stepCount: workflow.steps.length,
  };
}

function requireOrgId(context: ToolContext): string {
  const orgId = context.orgId?.trim();
  if (!orgId) {
    throw new Error("orgId is required.");
  }
  return orgId;
}

function readString(input: unknown, key: string): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : null;
}

function readObject(
  input: unknown,
  key: string
): Record<string, unknown> | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readSteps(input: unknown): WorkflowStep[] | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = (input as Record<string, unknown>).steps;
  if (!Array.isArray(value)) {
    return null;
  }

  return value as WorkflowStep[];
}
