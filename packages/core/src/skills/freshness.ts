export const SKILL_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
export const SKILL_ARCHIVE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

export type SkillFreshness = "active" | "stale" | "archive_due";

function toTimestamp(value: string | Date): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(time)) {
    throw new Error("Invalid skill freshness timestamp.");
  }
  return time;
}

export function classifySkillFreshness(input: {
  archiveAfterDays?: number;
  createdAt: string | Date;
  lastUsedAt?: string | Date | null;
  now?: Date;
  staleAfterDays?: number;
}): SkillFreshness {
  const now = input.now?.getTime() ?? Date.now();
  const clock = input.lastUsedAt
    ? toTimestamp(input.lastUsedAt)
    : toTimestamp(input.createdAt);
  const unusedForMs = now - clock;
  const dayMs = 24 * 60 * 60 * 1000;
  const staleAfterMs =
    input.staleAfterDays === undefined
      ? SKILL_STALE_AFTER_MS
      : input.staleAfterDays * dayMs;
  const archiveAfterMs =
    input.archiveAfterDays === undefined
      ? SKILL_ARCHIVE_AFTER_MS
      : input.archiveAfterDays * dayMs;

  if (unusedForMs >= archiveAfterMs) {
    return "archive_due";
  }

  if (unusedForMs >= staleAfterMs) {
    return "stale";
  }

  return "active";
}
