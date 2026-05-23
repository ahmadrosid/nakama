import type { AutomationDefinition } from "@tinyclaw/core";

export function getSchedule(definition: AutomationDefinition): string | null {
  return definition.trigger.type === "schedule" ? definition.trigger.cron : null;
}
