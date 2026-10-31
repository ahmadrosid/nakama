import type { DiscoveredSkill, SkillMatchOptions } from "./types";

const EXPLICIT_SKILL_PATTERN =
  /(?:^|\s)(?:\/skill|use skill|activate skill)\s+([a-z0-9-]+)\b/i;

/**
 * A pasted link's host says where, not what: "github.com/..." is not a GitHub
 * skill request. The path can say what ("docs.google.com/spreadsheets/..."),
 * so only the host is removed. Matches scheme, www. and bare host/path links,
 * and stops before closing brackets, quotes, and commas so glued words survive.
 */
const URL_PATTERN =
  /\b(?:[a-z][a-z0-9+.-]*:\/\/[^\s/)\]>"',]*|www\.[^\s/)\]>"',]*|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?=\/))([^\s)\]>"',]*)/gi;

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "to",
  "when",
  "use",
  "with",
  "user",
  "asks",
  "about",
  "working",
  "files",
  "file",
  "this",
  "that",
  "from",
  "into",
  "are",
  "is",
  "in",
  "on",
  "of",
  "by",
  "as",
  "at",
  "it",
  "be",
  "do",
  "does",
  "help",
  "helps",
  "using",
  "used",
  "find",
  "list",
  "link",
  "available",
]);

export function matchSkillsForMessage(
  skills: DiscoveredSkill[],
  userMessage: string,
  options: SkillMatchOptions = {}
): DiscoveredSkill[] {
  const message = userMessage.trim();

  if (!message || skills.length === 0) {
    return [];
  }

  const explicitName = extractExplicitSkillName(message);

  const normalized = message
    .replace(URL_PATTERN, (_url, linkPath: string) => ` ${linkPath} `)
    .toLowerCase();

  const matched: DiscoveredSkill[] = [];

  for (const skill of skills) {
    if (explicitName) {
      if (skill.name === explicitName) {
        matched.push(skill);
      }

      continue;
    }

    if (options.explicitOnly || skill.disableModelInvocation) {
      continue;
    }

    if (messageMatchesSkill(normalized, skill)) {
      matched.push(skill);
    }
  }

  return matched;
}

export function extractExplicitSkillName(message: string): string | null {
  const match = message.match(EXPLICIT_SKILL_PATTERN);

  return match?.[1]?.toLowerCase() ?? null;
}

/** `normalized` is the lowercased message with URLs removed. */
function messageMatchesSkill(
  normalized: string,
  skill: DiscoveredSkill
): boolean {
  if (containsWord(normalized, skill.name)) {
    return true;
  }

  const keywords = extractKeywords(skill.description);

  return keywords.some(
    (keyword) =>
      containsWord(normalized, keyword) ||
      containsWord(normalized, singularize(keyword))
  );
}

/** Descriptions list plurals ("artifacts"); users often type the singular. */
function singularize(word: string): string {
  return word.length > 4 && word.endsWith("s") && !word.endsWith("ss")
    ? word.slice(0, -1)
    : word;
}

function extractKeywords(description: string): string[] {
  return description
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .map((word) => word.trim())
    .filter(
      (word) =>
        word.length >= 4 &&
        !STOP_WORDS.has(word) &&
        !STOP_WORDS.has(singularize(word))
    );
}

function containsWord(haystack: string, word: string): boolean {
  const pattern = new RegExp(
    `(?:^|[^a-z0-9-])${escapeRegExp(word)}(?:[^a-z0-9-]|$)`
  );

  return pattern.test(haystack);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
