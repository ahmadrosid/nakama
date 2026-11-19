import { Cron, CronPattern } from "croner";
import { NakamaApiError } from "./api-error";
import type { AutomationTrigger } from "./contract";
import { DEFAULT_TIMEZONE, validateTimezone } from "./user-config";

const CRON_FIELD_PATTERN =
  /^(\*|[0-9]+(-[0-9]+)?(\/[0-9]+)?|\*\/[0-9]+|[0-9]+(,[0-9]+)*)$/;

const RUN_AT_CALENDAR_DATE = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?!\d)/;

// A short response or reload may cross a one-shot's due time after it was listed.
export const AUTOMATION_RUN_AT_GRACE_MS = 60_000;

export function isValidCronExpression(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);

  if (
    fields.length !== 5 ||
    !fields.every((field) => CRON_FIELD_PATTERN.test(field))
  ) {
    return false;
  }

  try {
    new CronPattern(cron.trim());

    return true;
  } catch {
    return false;
  }
}

export function isValidRunAt(at: string): boolean {
  const trimmed = at.trim();

  if (!trimmed) {
    return false;
  }

  return Number.isFinite(Date.parse(trimmed));
}

export function isWorkerSchedulable(
  automation: {
    enabled: boolean;
    trigger: AutomationTrigger;
  },
  now = Date.now()
): boolean {
  if (!automation.enabled) {
    return false;
  }

  if (automation.trigger.type === "schedule") {
    return true;
  }

  if (automation.trigger.type === "runAt") {
    return (
      Date.parse(automation.trigger.at) >= now - AUTOMATION_RUN_AT_GRACE_MS
    );
  }

  return false;
}

export function computeAutomationNextRunAt(
  trigger: AutomationTrigger,
  userTimezone = DEFAULT_TIMEZONE
): string | null {
  if (trigger.type === "runAt") {
    const at = Date.parse(trigger.at);

    return Number.isFinite(at) && at > Date.now()
      ? new Date(at).toISOString()
      : null;
  }

  if (trigger.type !== "schedule" || !trigger.cron.trim()) {
    return null;
  }

  const timezone = trigger.timezone ?? userTimezone;

  const next = new Cron(trigger.cron, {
    paused: true,
    timezone,
  }).nextRun();

  return next ? next.toISOString() : null;
}

export function validateAutomationInput(input: {
  // Undefined, not just empty: request bodies reach this unvalidated, so an
  // absent field has to name itself here rather than throw a TypeError.
  name: string | undefined;
  prompt: string | undefined;
  trigger: AutomationTrigger;
}): void {
  const name = input.name?.trim() ?? "";
  const prompt = input.prompt?.trim() ?? "";

  if (!name) {
    throw new Error("Automation name is required.");
  }

  if (!prompt) {
    throw new Error("Automation prompt is required.");
  }

  if (input.trigger.type === "schedule") {
    if (!isValidCronExpression(input.trigger.cron)) {
      throw new NakamaApiError(
        `Invalid cron expression: ${input.trigger.cron}`,
        400
      );
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
  userTimezone: string
): AutomationTrigger {
  if (trigger.type === "schedule") {
    return {
      ...trigger,
      timezone: validateTimezone(trigger.timezone ?? userTimezone),
    };
  }

  if (trigger.type === "runAt") {
    const at = trigger.at.trim();
    const calendarDate = RUN_AT_CALENDAR_DATE.exec(at);

    // Validate new dates here so an update can still pause a legacy job.
    if (calendarDate) {
      const year = Number(calendarDate[1]);
      const month = Number(calendarDate[2]);
      const day = Number(calendarDate[3]);

      // The 400-year cycle preserves leap years and avoids Date's year limits.
      const lastDay = new Date(
        Date.UTC(2000 + (year % 400), month, 0)
      ).getUTCDate();

      if (month < 1 || month > 12 || day < 1 || day > lastDay) {
        throw new NakamaApiError(`Invalid runAt datetime: ${at}`, 400);
      }
    }

    return {
      ...trigger,
      at,
      timezone: validateTimezone(trigger.timezone ?? userTimezone),
    };
  }

  return trigger;
}

export { DEFAULT_TIMEZONE, validateTimezone };
