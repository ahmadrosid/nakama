import { Cron, CronPattern } from "croner";
import { NakamaApiError } from "./api-error";
import type { AutomationTrigger } from "./contract";
import { DEFAULT_TIMEZONE, validateTimezone } from "./user-config";

const CRON_FIELD_PATTERN =
  /^(\*|[0-9]+(-[0-9]+)?(\/[0-9]+)?|\*\/[0-9]+|[0-9]+(,[0-9]+)*)$/;

// A day of 29 to 31 that is not part of a time, a fraction or a longer number.
const RUN_AT_LONG_DAY = /(?<![\d:]|:\d\d\.)(29|30|31)(?![\d:])/g;

const RUN_AT_HOUR_24 = /(?<![\d:])24:\d\d/;

const DAY_MS = 86_400_000;

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
  const parsed = Date.parse(trimmed);

  // Date.parse moves hour 24 to the next day.
  if (!Number.isFinite(parsed) || RUN_AT_HOUR_24.test(trimmed)) {
    return false;
  }

  // Date.parse also moves February 30 to March 1. Parse the same text with
  // day 15: the month is then sure, in each format and time zone.
  for (const match of trimmed.matchAll(RUN_AT_LONG_DAY)) {
    const day = Number(match[1]);

    const midMonth = Date.parse(
      `${trimmed.slice(0, match.index)}15${trimmed.slice(match.index + 2)}`
    );

    // More than one hour (DST) of difference: the number is not the day.
    if (Math.abs(parsed - midMonth - (day - 15) * DAY_MS) > 3_600_000) {
      continue;
    }

    const month = new Date(midMonth);

    const lastDay = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)
    ).getUTCDate();

    if (day > lastDay) {
      return false;
    }
  }

  return true;
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
  // Absent on an update that keeps its trigger: a legacy job can still pause.
  trigger: AutomationTrigger | undefined;
}): void {
  const name = input.name?.trim() ?? "";
  const prompt = input.prompt?.trim() ?? "";

  if (!name) {
    throw new Error("Automation name is required.");
  }

  if (!prompt) {
    throw new Error("Automation prompt is required.");
  }

  if (input.trigger?.type === "schedule") {
    if (!isValidCronExpression(input.trigger.cron)) {
      throw new NakamaApiError(
        `Invalid cron expression: ${input.trigger.cron}`,
        400
      );
    }

    validateTimezone(input.trigger.timezone);
  }

  if (input.trigger?.type === "runAt") {
    if (!isValidRunAt(input.trigger.at)) {
      throw new NakamaApiError(
        `Invalid runAt datetime: ${input.trigger.at}`,
        400
      );
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
    return {
      ...trigger,
      at: trigger.at.trim(),
      timezone: validateTimezone(trigger.timezone ?? userTimezone),
    };
  }

  return trigger;
}

export { DEFAULT_TIMEZONE, validateTimezone };
