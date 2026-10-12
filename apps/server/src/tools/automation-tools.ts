import {
  emptyObjectSchema,
  normalizeAutomationDelivery,
  requireToolNotViewer,
  type ToolContext,
  type ToolDefinition,
} from "@nakama/core";
import { z } from "zod";
import type { AutomationRunner } from "../services/automation-runner";
import type { AutomationService } from "../services/automation-service";

const AutomationTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({
    cron: z.string().transform((cron) => cron.trim()),
    timezone: z
      .string()
      .optional()
      .transform((timezone) => timezone?.trim()),
    type: z.literal("schedule"),
  }),
  z.object({
    at: z.string().transform((at) => at.trim()),
    timezone: z
      .string()
      .optional()
      .transform((timezone) => timezone?.trim()),
    type: z.literal("runAt"),
  }),
]);

const AutomationInputSchema = z.object({
  automationId: z.string().optional().catch(undefined),
  delivery: z.unknown().optional(),
  description: z.string().optional().catch(undefined),
  limit: z.number().optional().catch(undefined),
  name: z.string().optional().catch(undefined),
  profileId: z.string().optional().catch(undefined),
  prompt: z.string().optional().catch(undefined),
  trigger: AutomationTriggerSchema.optional().catch(undefined),
});

export function createAutomationTools(
  automationService: AutomationService,
  automationRunner: AutomationRunner
): ToolDefinition[] {
  return [
    {
      description:
        "Create and save an automation that runs a prompt on a schedule, at a specific time once, or manually. When the user wants results sent to Telegram, WhatsApp, email, or Discord after each run, set delivery — the server sends automatically; put only the task in prompt.",
      name: "create_automation",
      parameters: {
        additionalProperties: false,
        properties: {
          delivery: {
            additionalProperties: true,
            description:
              'Optional. When the user wants run results sent somewhere: { "channel": "telegram" | "whatsapp" | "email" | "discord", "to": "user@example.com" (required for email), "channelId": "discord snowflake" (optional guild text channel; omit to DM paired Discord users), "notifyOn": "success" | "failure" | "both" }. Omit when the user only wants results saved.',
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
          profileId: {
            description:
              "Optional org profile id to run as. Omit to use the current chat profile. Super Bot requires org admin or platform admin.",
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
        const parsedInput = AutomationInputSchema.parse(input);

        requireToolNotViewer(context);
        const orgId = requireOrgId(context);
        const name = readString(parsedInput, "name");
        const description = readString(parsedInput, "description");
        const prompt = readString(parsedInput, "prompt");
        const trigger = readTrigger(parsedInput.trigger);
        const delivery = readDelivery(parsedInput);
        const requestedProfileId = readString(parsedInput, "profileId")?.trim();

        if (!(name && description && prompt && trigger)) {
          throw new Error(
            "name, description, prompt, and trigger are required."
          );
        }

        const profileId = requestedProfileId || context.profileId?.trim();

        if (!profileId) {
          throw new Error(
            "Automation must be created from an active chat session."
          );
        }

        const createInput: Parameters<AutomationService["create"]>[1] = {
          description,
          name,
          prompt,
          trigger,
        };

        if (delivery) {
          createInput.delivery = delivery;
        }

        const automation = await automationService.create(
          orgId,
          createInput,
          profileId,
          {
            isPlatformAdmin: context.isPlatformAdmin,
            orgRole: context.orgRole,
          }
        );

        return {
          delivery: automation.delivery ?? null,
          description: automation.description,
          enabled: automation.enabled,
          id: automation.id,
          name: automation.name,
          nextRunAt: automation.nextRunAt ?? null,
          profileId: automation.profileId,
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
          profileId: automation.profileId,
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
        const parsedInput = AutomationInputSchema.parse(input);

        requireToolNotViewer(context);
        const orgId = requireOrgId(context);
        const automationId = readString(parsedInput, "automationId");

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
        const parsedInput = AutomationInputSchema.parse(input);

        requireToolNotViewer(context);
        const orgId = requireOrgId(context);
        const automationId = readString(parsedInput, "automationId");

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
        const parsedInput = AutomationInputSchema.parse(input);

        const orgId = requireOrgId(context);
        const automationId = context.automationId?.trim();

        if (!automationId) {
          throw new Error("automationId is required.");
        }

        const limit = readLimit(parsedInput.limit);
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

function readString(
  input: z.infer<typeof AutomationInputSchema>,
  key: "automationId" | "description" | "name" | "profileId" | "prompt"
): string | null {
  const value = input[key];

  return value?.trim() || null;
}

function readLimit(value: number | undefined): number {
  const limit = value !== undefined && Number.isFinite(value) ? value : 5;

  return Math.min(20, Math.max(1, Math.trunc(limit)));
}

function readTrigger(
  input: z.infer<typeof AutomationTriggerSchema> | undefined
):
  | { type: "manual" }
  | { type: "schedule"; cron: string; timezone?: string }
  | { type: "runAt"; at: string; timezone?: string }
  | null {
  return input ?? null;
}

function readDelivery(input: z.infer<typeof AutomationInputSchema>) {
  const value = input.delivery;

  if (value === undefined || value === null) {
    return;
  }

  return normalizeAutomationDelivery(value);
}
