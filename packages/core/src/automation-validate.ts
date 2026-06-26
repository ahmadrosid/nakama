import { Cron } from "croner";
import type { AutomationTrigger } from "./contract";
import { DEFAULT_TIMEZONE, validateTimezone } from "./user-config";

const CRON_FIELD_PATTERN =
  /^(\*|[0-9]+(-[0-9]+)?(\/[0-9]+)?|\*\/[0-9]+|[0-9]+(,[0-9]+)*)$/;

export function isValidCronExpression(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);

  if (fields.length !== 5) {
    return false;
  }

  return fields.every((field) => CRON_FIELD_PATTERN.test(field));
}

export function isValidRunAt(at: string): boolean {
  const trimmed = at.trim();
  if (!trimmed) {
    return false;
  }

  return Number.isFinite(Date.parse(trimmed));
}

export function isWorkerSchedulable(automation: {
  enabled: boolean;
  trigger: AutomationTrigger;
}): boolean {
  if (!automation.enabled) {
    return false;
  }

  if (automation.trigger.type === "schedule") {
    return true;
  }

  if (automation.trigger.type === "runAt") {
    return Date.parse(automation.trigger.at) > Date.now();
  }

  return false;
}

export function computeAutomationNextRunAt(
  trigger: AutomationTrigger,
  userTimezone = DEFAULT_TIMEZONE,
): string | null {
  if (trigger.type === "runAt") {
    const at = Date.parse(trigger.at);
    return Number.isFinite(at) && at > Date.now() ? new Date(at).toISOString() : null;
  }

  if (trigger.type !== "schedule" || !trigger.cron.trim()) {
    return null;
  }

  const timezone = trigger.timezone ?? userTimezone;
  const next = new Cron(trigger.cron, {
    timezone,
    paused: true,
  }).nextRun();

  return next ? next.toISOString() : null;
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

  if (input.trigger.type === "runAt") {
    if (!isValidRunAt(input.trigger.at)) {
      throw new Error(`Invalid runAt datetime: ${input.trigger.at}`);
    }

    validateTimezone(input.trigger.timezone);
  }
}

export function resolveScheduleTimezone(
  trigger: AutomationTrigger,
  userTimezone: string,
): AutomationTrigger {
  if (trigger.type === "schedule") {
    return {
      ...trigger,
      timezone: validateTimezone(trigger.timezone ?? userTimezone),
    };
  }

  if (trigger.type === "runAt") {
    return {
      ...trigger,
      at: trigger.at.trim(),
      timezone: validateTimezone(trigger.timezone ?? userTimezone),
    };
  }

  return trigger;
}

export { validateTimezone, DEFAULT_TIMEZONE };
