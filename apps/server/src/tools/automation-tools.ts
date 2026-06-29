import { emptyObjectSchema, normalizeAutomationDelivery, type ToolContext, type ToolDefinition } from "@tinyclaw/core";
import type { AutomationRunner } from "../services/automation-runner";
import type { AutomationService } from "../services/automation-service";

export function createAutomationTools(
  automationService: AutomationService,
  automationRunner: AutomationRunner,
): ToolDefinition[] {
  return [
    {
      name: "create_automation",
      description:
        "Create and save an automation that runs a prompt on a schedule, at a specific time once, or manually. When the user wants results sent to Telegram, WhatsApp, or email after each run, set delivery — the server sends automatically; put only the task in prompt.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short title for the automation." },
          description: {
            type: "string",
            description: "One sentence summary of what the automation does.",
          },
          prompt: {
            type: "string",
            description:
              "The task prompt to execute when the automation runs. Describe the work only — do not include delivery instructions when delivery is set.",
          },
          trigger: {
            type: "object",
            description:
              'Manual: { "type": "manual" }. Recurring: { "type": "schedule", "cron": "0 8 * * *", "timezone": "America/Los_Angeles" }. One-time: { "type": "runAt", "at": "2026-06-27T13:00:00.000Z", "timezone": "Asia/Jakarta" }.',
            additionalProperties: true,
          },
          delivery: {
            type: "object",
            description:
              'Optional. When the user wants run results sent somewhere: { "channel": "telegram" | "whatsapp" | "email", "to": "user@example.com" (required for email), "notifyOn": "success" | "failure" | "both" }. Omit when the user only wants results saved.',
            additionalProperties: true,
          },
        },
        required: ["name", "description", "prompt", "trigger"],
        additionalProperties: false,
      },
      async run(input, context) {
        const orgId = requireOrgId(context);
        const name = readString(input, "name");
        const description = readString(input, "description");
        const prompt = readString(input, "prompt");
        const trigger = readTrigger(input, "trigger");
        const delivery = readDelivery(input);

        if (!name || !description || !prompt || !trigger) {
          throw new Error("name, description, prompt, and trigger are required.");
        }

        const profileId = context.profileId;

        if (!profileId) {
          throw new Error("Automation must be created from an active chat session.");
        }

        const automation = await automationService.create(
          orgId,
          { name, description, prompt, trigger, ...(delivery ? { delivery } : {}) },
          profileId,
        );

        return {
          id: automation.id,
          name: automation.name,
          description: automation.description,
          prompt: automation.prompt,
          trigger: automation.trigger,
          delivery: automation.delivery ?? null,
          enabled: automation.enabled,
          nextRunAt: automation.nextRunAt ?? null,
        };
      },
    },
    {
      name: "list_automations",
      description: "List saved automations with their schedule and status.",
      parameters: emptyObjectSchema(),
      async run(_input, context) {
        const orgId = requireOrgId(context);
        const { automations } = await automationService.listForOrg(orgId);
        return automations.map((automation) => ({
          id: automation.id,
          name: automation.name,
          description: automation.description,
          prompt: automation.prompt,
          trigger: automation.trigger,
          delivery: automation.delivery ?? null,
          enabled: automation.enabled,
          nextRunAt: automation.nextRunAt ?? null,
          lastRunAt: automation.lastRunAt ?? null,
        }));
      },
    },
    {
      name: "delete_automation",
      description: "Delete a saved automation by id.",
      parameters: {
        type: "object",
        properties: {
          automationId: { type: "string", description: "Automation id to delete." },
        },
        required: ["automationId"],
        additionalProperties: false,
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

        return { deleted: true, automationId };
      },
    },
    {
      name: "run_automation",
      description:
        "Run a saved automation immediately when the user asks to trigger or test it from chat. Returns the run output or error.",
      parameters: {
        type: "object",
        properties: {
          automationId: {
            type: "string",
            description: "Automation id to run (use list_automations to find it).",
          },
        },
        required: ["automationId"],
        additionalProperties: false,
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
            name: automation.name,
            status: "failed" as const,
            output: null,
            error: result.error,
          };
        }

        return {
          automationId,
          name: automation.name,
          status: "completed" as const,
          output: result.output ?? null,
          error: null,
        };
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

function readTrigger(
  input: unknown,
  key: string,
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
      type: "schedule",
      cron: trigger.cron.trim(),
      timezone:
        typeof trigger.timezone === "string" ? trigger.timezone.trim() : undefined,
    };
  }

  if (trigger.type === "runAt" && typeof trigger.at === "string") {
    return {
      type: "runAt",
      at: trigger.at.trim(),
      timezone:
        typeof trigger.timezone === "string" ? trigger.timezone.trim() : undefined,
    };
  }

  return null;
}

function readDelivery(input: unknown) {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const value = (input as Record<string, unknown>).delivery;

  if (value === undefined || value === null) {
    return undefined;
  }

  return normalizeAutomationDelivery(value);
}
