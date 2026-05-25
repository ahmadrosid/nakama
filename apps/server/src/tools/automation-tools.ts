import { emptyObjectSchema, type ToolDefinition } from "@tinyclaw/core";
import type { AutomationService } from "../services/automation-service";

export function createAutomationTools(
  automationService: AutomationService,
): ToolDefinition[] {
  return [
    {
      name: "create_automation",
      description:
        "Create and save an automation that re-runs a prompt on a schedule or manually. Use when the user wants a recurring or saved task.",
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
            description: "The task prompt to execute each time the automation runs.",
          },
          trigger: {
            type: "object",
            description:
              'Either { "type": "manual" } or { "type": "schedule", "cron": "0 8 * * *", "timezone": "America/Los_Angeles" }.',
            additionalProperties: true,
          },
        },
        required: ["name", "description", "prompt", "trigger"],
        additionalProperties: false,
      },
      async run(input, context) {
        const name = readString(input, "name");
        const description = readString(input, "description");
        const prompt = readString(input, "prompt");
        const trigger = readTrigger(input, "trigger");

        if (!name || !description || !prompt || !trigger) {
          throw new Error("name, description, prompt, and trigger are required.");
        }

        const profileId = context.profileId;

        if (!profileId) {
          throw new Error("Automation must be created from an active chat session.");
        }

        const automation = await automationService.create(
          { name, description, prompt, trigger },
          profileId,
        );

        return {
          id: automation.id,
          name: automation.name,
          description: automation.description,
          prompt: automation.prompt,
          trigger: automation.trigger,
          enabled: automation.enabled,
          nextRunAt: automation.nextRunAt ?? null,
        };
      },
    },
    {
      name: "list_automations",
      description: "List saved automations with their schedule and status.",
      parameters: emptyObjectSchema(),
      async run() {
        const automations = await automationService.list();
        return automations.map((automation) => ({
          id: automation.id,
          name: automation.name,
          description: automation.description,
          prompt: automation.prompt,
          trigger: automation.trigger,
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
      async run(input) {
        const automationId = readString(input, "automationId");

        if (!automationId) {
          throw new Error("automationId is required.");
        }

        const deleted = await automationService.delete(automationId);

        if (!deleted) {
          throw new Error("Automation not found.");
        }

        return { deleted: true, automationId };
      },
    },
  ];
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
): { type: "manual" } | { type: "schedule"; cron: string; timezone?: string } | null {
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

  return null;
}
