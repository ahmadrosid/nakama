import {
  emptyObjectSchema,
  normalizeAutomationDelivery,
  type ToolContext,
  type ToolDefinition,
} from "@nakama/core";
import type { AutomationRunner } from "../services/automation-runner";
import type { AutomationService } from "../services/automation-service";

export function createAutomationTools(
  automationService: AutomationService,
  automationRunner: AutomationRunner
): ToolDefinition[] {
  return [
    {
      description:
        "Create and save an automation that runs a prompt on a schedule, at a specific time once, or manually. When the user wants results sent to Telegram, WhatsApp, or email after each run, set delivery — the server sends automatically; put only the task in prompt.",
      name: "create_automation",
      parameters: {
        additionalProperties: false,
        properties: {
          delivery: {
            additionalProperties: true,
            description:
              'Optional. When the user wants run results sent somewhere: { "channel": "telegram" | "whatsapp" | "email", "to": "user@example.com" (required for email), "notifyOn": "success" | "failure" | "both" }. Omit when the user only wants results saved.',
            type: "object",
          },
          description: {
            description: "One sentence summary of what the automation does.",
            type: "string",
          },
          name: {
            description: "Short title for the automation.",
            type: "string",
          },
          prompt: {
            description:
              "The task prompt to execute when the automation runs. Describe the work only — do not include delivery instructions when delivery is set.",
            type: "string",
          },
          trigger: {
            additionalProperties: true,
            description:
              'Manual: { "type": "manual" }. Recurring: { "type": "schedule", "cron": "0 8 * * *", "timezone": "America/Los_Angeles" }. One-time: { "type": "runAt", "at": "2026-06-27T13:00:00.000Z", "timezone": "Asia/Jakarta" }.',
            type: "object",
          },
        },
        required: ["name", "description", "prompt", "trigger"],
        type: "object",
      },
      async run(input, context) {
        const orgId = requireOrgId(context);
        const name = readString(input, "name");
        const description = readString(input, "description");
        const prompt = readString(input, "prompt");
        const trigger = readTrigger(input, "trigger");
        const delivery = readDelivery(input);

        if (!(name && description && prompt && trigger)) {
          throw new Error(
            "name, description, prompt, and trigger are required."
          );
        }

        const profileId = context.profileId;

        if (!profileId) {
          throw new Error(
            "Automation must be created from an active chat session."
          );
        }

        const automation = await automationService.create(
          orgId,
          {
            description,
            name,
            prompt,
            trigger,
            ...(delivery ? { delivery } : {}),
          },
          profileId
        );

        return {
          delivery: automation.delivery ?? null,
          description: automation.description,
          enabled: automation.enabled,
          id: automation.id,
          name: automation.name,
          nextRunAt: automation.nextRunAt ?? null,
          prompt: automation.prompt,
          trigger: automation.trigger,
        };
      },
    },
    {
      description: "List saved automations with their schedule and status.",
      name: "list_automations",
      parameters: emptyObjectSchema(),
      async run(_input, context) {
        const orgId = requireOrgId(context);
        const { automations } = await automationService.listForOrg(orgId);
        return automations.map((automation) => ({
          delivery: automation.delivery ?? null,
          description: automation.description,
          enabled: automation.enabled,
          id: automation.id,
          lastRunAt: automation.lastRunAt ?? null,
          name: automation.name,
          nextRunAt: automation.nextRunAt ?? null,
          prompt: automation.prompt,
          trigger: automation.trigger,
        }));
      },
    },
    {
      description: "Delete a saved automation by id.",
      name: "delete_automation",
      parameters: {
        additionalProperties: false,
        properties: {
          automationId: {
            description: "Automation id to delete.",
            type: "string",
          },
        },
        required: ["automationId"],
        type: "object",
      },
      async run(input, context) {
        const orgId = requireOrgId(context);
        const automationId = readString(input, "automationId");

        if (!automationId) {
          throw new Error("automationId is required.");
        }

        const deleted = await automationService.delete(automationId, orgId);

        if (!deleted) {
          throw new Error("Automation not found.");
        }

        return { automationId, deleted: true };
      },
    },
    {
      description:
        "Run a saved automation immediately when the user asks to trigger or test it from chat. Returns the run output or error.",
      name: "run_automation",
      parameters: {
        additionalProperties: false,
        properties: {
          automationId: {
            description:
              "Automation id to run (use list_automations to find it).",
            type: "string",
          },
        },
        required: ["automationId"],
        type: "object",
      },
      async run(input, context) {
        const orgId = requireOrgId(context);
        const automationId = readString(input, "automationId");

        if (!automationId) {
          throw new Error("automationId is required.");
        }

        const automation = await automationService.get(automationId, orgId);

        if (!automation) {
          throw new Error("Automation not found.");
        }

        const result = await automationRunner.run(automationId);

        if (result.skipped) {
          throw new Error(result.error ?? "Automation run skipped.");
        }

        if (result.error) {
          return {
            automationId,
            error: result.error,
            name: automation.name,
            output: null,
            status: "failed" as const,
          };
        }

        return {
          automationId,
          error: null,
          name: automation.name,
          output: result.output ?? null,
          status: "completed" as const,
        };
      },
    },
  ];
}

export function createAutomationRunHistoryTools(
  automationService: AutomationService
): ToolDefinition[] {
  return [
    {
      description:
        "List recent previous runs for the currently running automation. Use this only when past outputs or failures would help complete the current automation run.",
      name: "list_previous_automation_runs",
      parameters: {
        additionalProperties: false,
        properties: {
          limit: {
            description:
              "Maximum number of previous runs to return. Defaults to 5, max 20.",
            type: "number",
          },
        },
        type: "object",
      },
      async run(input, context) {
        const orgId = requireOrgId(context);
        const automationId = context.automationId?.trim();

        if (!automationId) {
          throw new Error("automationId is required.");
        }

        const limit = readLimit(input);
        const fetchLimit = context.automationRunId ? limit + 1 : limit;
        const runs = await automationService.listRuns(
          automationId,
          orgId,
          fetchLimit
        );

        return runs
          .filter((run) => run.id !== context.automationRunId)
          .slice(0, limit)
          .map((run) => ({
            completedAt: run.completedAt,
            error: run.error,
            id: run.id,
            output: run.output,
            startedAt: run.startedAt,
            status: run.status,
          }));
      },
    },
  ];
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
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readLimit(input: unknown): number {
  const value =
    input && typeof input === "object"
      ? (input as Record<string, unknown>).limit
      : undefined;
  const limit = typeof value === "number" && Number.isFinite(value) ? value : 5;

  return Math.min(20, Math.max(1, Math.trunc(limit)));
}

function readTrigger(
  input: unknown,
  key: string
):
  | { type: "manual" }
  | { type: "schedule"; cron: string; timezone?: string }
  | { type: "runAt"; at: string; timezone?: string }
  | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];

  if (!value || typeof value !== "object") {
    return null;
  }

  const trigger = value as Record<string, unknown>;

  if (trigger.type === "manual") {
    return { type: "manual" };
  }

  if (trigger.type === "schedule" && typeof trigger.cron === "string") {
    return {
      cron: trigger.cron.trim(),
      timezone:
        typeof trigger.timezone === "string"
          ? trigger.timezone.trim()
          : undefined,
      type: "schedule",
    };
  }

  if (trigger.type === "runAt" && typeof trigger.at === "string") {
    return {
      at: trigger.at.trim(),
      timezone:
        typeof trigger.timezone === "string"
          ? trigger.timezone.trim()
          : undefined,
      type: "runAt",
    };
  }

  return null;
}

function readDelivery(input: unknown) {
  if (!input || typeof input !== "object") {
    return;
  }

  const value = (input as Record<string, unknown>).delivery;

  if (value === undefined || value === null) {
    return;
  }

  return normalizeAutomationDelivery(value);
}
