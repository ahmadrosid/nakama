import type { SkillSummary } from "@nakama/core/contract";

export interface SkillSlashRange {
  end: number;
  query: string;
  start: number;
}

export interface SkillTokenRange {
  end: number;
  name: string;
  start: number;
}

export interface ReservedSlashCommand {
  description: string;
  name: string;
}

export type ComposerSlashSuggestion =
  | { kind: "command"; command: ReservedSlashCommand }
  | { kind: "skill"; skill: SkillSummary };

const EXPLICIT_SKILL_TOKEN_PATTERN = /(?:^|\s)\/skill\s+([a-z0-9-]+)\b/g;
const HIDDEN_SLASH_SKILL_NAMES = new Set<string>([
  "create-automation",
  "manage-skills",
  "update-profile-memory",
  "archive-profile-memory",
  "save-artifact",
]);

/** Composer slash tokens that are not skill names (must not become `/skill …`). */
export const RESERVED_COMPOSER_SLASH_COMMANDS: ReservedSlashCommand[] = [
  {
    description: "Distill a reusable skill from sources",
    name: "learn",
  },
];

export function findActiveSkillSlashRange(
  value: string,
  cursorIndex: number
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
    end: boundedCursor,
    query,
    start: slashIndex,
  };
}

export function filterReservedSlashCommands(
  query: string
): ReservedSlashCommand[] {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return [...RESERVED_COMPOSER_SLASH_COMMANDS];
  }

  // Name-prefix only — description matching made "/re" steal focus via "reusable".
  return RESERVED_COMPOSER_SLASH_COMMANDS.filter((command) =>
    command.name.toLowerCase().startsWith(normalized)
  );
}

export function profileCanUseLearnCommand(skills: SkillSummary[]): boolean {
  return skills.some((skill) => skill.name === "manage-skills");
}

export function filterSkillsForSlashQuery(
  skills: SkillSummary[],
  query: string
): SkillSummary[] {
  const visibleSkills = skills.filter(
    (skill) => !HIDDEN_SLASH_SKILL_NAMES.has(skill.name)
  );
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

export function filterComposerSlashSuggestions(
  skills: SkillSummary[],
  query: string
): ComposerSlashSuggestion[] {
  const commands = profileCanUseLearnCommand(skills)
    ? filterReservedSlashCommands(query).map((command) => ({
        command,
        kind: "command" as const,
      }))
    : [];
  const skillSuggestions = filterSkillsForSlashQuery(skills, query).map(
    (skill) => ({
      kind: "skill" as const,
      skill,
    })
  );

  return [...commands, ...skillSuggestions];
}

export function replaceSlashRangeWithSkillInvocation(
  value: string,
  range: SkillSlashRange,
  skill: Pick<SkillSummary, "name">
): { value: string; cursorIndex: number } {
  const invocation = `/skill ${skill.name} `;
  const nextValue = `${value.slice(0, range.start)}${invocation}${value.slice(range.end)}`;

  return {
    cursorIndex: range.start + invocation.length,
    value: nextValue,
  };
}

export function replaceSlashRangeWithReservedCommand(
  value: string,
  range: SkillSlashRange,
  command: Pick<ReservedSlashCommand, "name">
): { value: string; cursorIndex: number } {
  const insertion = `/${command.name} `;
  const nextValue = `${value.slice(0, range.start)}${insertion}${value.slice(range.end)}`;

  return {
    cursorIndex: range.start + insertion.length,
    value: nextValue,
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
      end: start + fullMatch.length - leadingWhitespace,
      name,
      start,
    });
  }

  return ranges;
}

// Only a leading command is real: the server trims then treats `/learn …` as a
// command, so mid-sentence `/learn` is plain text and must not be highlighted.
const RESERVED_COMMAND_NAMES = RESERVED_COMPOSER_SLASH_COMMANDS.map(
  (command) => command.name
).join("|");
const LEADING_RESERVED_COMMAND_PATTERN = new RegExp(
  String.raw`^(\s*)(/(?:` + RESERVED_COMMAND_NAMES + String.raw`))(?=\s|$)`
);

/** Range of a leading reserved command (e.g. `/learn`) for composer highlighting. */
export function getReservedCommandTokenRanges(
  value: string,
  options: { enableLearn?: boolean } = {}
): SkillTokenRange[] {
  if (options.enableLearn === false) {
    return [];
  }

  const match = LEADING_RESERVED_COMMAND_PATTERN.exec(value);
  const token = match?.[2];

  if (!(match && token)) {
    return [];
  }

  const start = match[1]?.length ?? 0;
  return [
    {
      end: start + token.length,
      name: token.slice(1),
      start,
    },
  ];
}
