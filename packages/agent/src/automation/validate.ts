import type { AutomationTrigger } from "@tinyclaw/core";
import { DEFAULT_TIMEZONE, isValidTimezone } from "@tinyclaw/core";

const CRON_FIELD_PATTERN =
  /^(\*|[0-9]+(-[0-9]+)?(\/[0-9]+)?|\*\/[0-9]+|[0-9]+(,[0-9]+)*)$/;

export function isValidCronExpression(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);

  if (fields.length !== 5) {
    return false;
  }

  return fields.every((field) => CRON_FIELD_PATTERN.test(field));
}

export function validateTimezone(timezone: string | undefined): string {
  const value = timezone?.trim() || DEFAULT_TIMEZONE;

  if (!isValidTimezone(value)) {
    throw new Error(`Invalid timezone: ${value}`);
  }

  return value;
}

export function validateAutomationInput(input: {
  name: string;
  prompt: string;
  trigger: AutomationTrigger;
}): void {
  const name = input.name.trim();
  const prompt = input.prompt.trim();

  if (!name) {
    throw new Error("Automation name is required.");
  }

  if (!prompt) {
    throw new Error("Automation prompt is required.");
  }

  if (input.trigger.type === "schedule") {
    if (!isValidCronExpression(input.trigger.cron)) {
      throw new Error(`Invalid cron expression: ${input.trigger.cron}`);
    }

    validateTimezone(input.trigger.timezone);
  }
}

export function resolveScheduleTimezone(
  trigger: AutomationTrigger,
  userTimezone: string,
): AutomationTrigger {
  if (trigger.type !== "schedule") {
    return trigger;
  }

  return {
    ...trigger,
    timezone: validateTimezone(trigger.timezone ?? userTimezone),
  };
}
