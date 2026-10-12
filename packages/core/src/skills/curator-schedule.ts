export const SKILL_CURATOR_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export type CuratorScheduleAction = "skip" | "seed" | "schedule";

export function resolveCuratorScheduleAction(input: {
  enabled: boolean;
  lastRunAt?: string | null;
  now?: Date;
}): CuratorScheduleAction {
  if (!input.enabled) {
    return "skip";
  }

  if (!input.lastRunAt) {
    return "seed";
  }

  const lastRunAt = Date.parse(input.lastRunAt);

  if (Number.isNaN(lastRunAt)) {
    return "seed";
  }

  const now = input.now?.getTime() ?? Date.now();

  if (now - lastRunAt >= SKILL_CURATOR_INTERVAL_MS) {
    return "schedule";
  }

  return "skip";
}
