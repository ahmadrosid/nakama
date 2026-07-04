import type { SkillSummary } from "@tinyclaw/core/contract";

export interface SkillSlashRange {
  start: number;
  end: number;
  query: string;
}

export interface SkillTokenRange {
  start: number;
  end: number;
  name: string;
}

const EXPLICIT_SKILL_TOKEN_PATTERN = /(?:^|\s)\/skill\s+([a-z0-9-]+)\b/g;
const HIDDEN_SLASH_SKILL_NAMES = new Set<string>(["create-automation", "manage-skills"]);

export function findActiveSkillSlashRange(
  value: string,
  cursorIndex: number,
): SkillSlashRange | null {
  const boundedCursor = Math.max(0, Math.min(cursorIndex, value.length));
  const beforeCursor = value.slice(0, boundedCursor);
  const slashIndex = beforeCursor.lastIndexOf("/");

  if (slashIndex === -1) {
    return null;
  }

  const previous = slashIndex > 0 ? value[slashIndex - 1] : "";
  if (previous && !/\s/.test(previous)) {
    return null;
  }

  const query = value.slice(slashIndex + 1, boundedCursor);
  if (/\s/.test(query)) {
    return null;
  }

  return {
    start: slashIndex,
    end: boundedCursor,
    query,
  };
}

export function filterSkillsForSlashQuery(
  skills: SkillSummary[],
  query: string,
): SkillSummary[] {
  const visibleSkills = skills.filter((skill) => !HIDDEN_SLASH_SKILL_NAMES.has(skill.name));
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return visibleSkills;
  }

  return visibleSkills.filter((skill) => {
    const name = skill.name.toLowerCase();
    const description = skill.description.toLowerCase();
    return name.includes(normalized) || description.includes(normalized);
  });
}

export function replaceSlashRangeWithSkillInvocation(
  value: string,
  range: SkillSlashRange,
  skill: Pick<SkillSummary, "name">,
): { value: string; cursorIndex: number } {
  const invocation = `/skill ${skill.name} `;
  const nextValue = `${value.slice(0, range.start)}${invocation}${value.slice(range.end)}`;

  return {
    value: nextValue,
    cursorIndex: range.start + invocation.length,
  };
}

export function getSkillTokenRanges(value: string): SkillTokenRange[] {
  const ranges: SkillTokenRange[] = [];

  for (const match of value.matchAll(EXPLICIT_SKILL_TOKEN_PATTERN)) {
    const fullMatch = match[0] ?? "";
    const leadingWhitespace = fullMatch.startsWith("/skill") ? 0 : 1;
    const start = (match.index ?? 0) + leadingWhitespace;
    const name = match[1];

    if (!name) {
      continue;
    }

    ranges.push({
      start,
      end: start + fullMatch.length - leadingWhitespace,
      name,
    });
  }

  return ranges;
}
