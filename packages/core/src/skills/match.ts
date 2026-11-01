import type { DiscoveredSkill } from "./types";

const EXPLICIT_SKILL_PATTERN =
  /(?:^|\s)(?:\/skill|use skill|activate skill)\s+([a-z0-9-]+)\b/i;

/**
 * The skill the user named with `/skill <name>`, `use skill <name>`, or
 * `activate skill <name>`. Any other skill is the model's choice: it reads the
 * catalog and calls `load_skill`.
 */
export function findExplicitSkill(
  skills: DiscoveredSkill[],
  userMessage: string
): DiscoveredSkill | null {
  const name = extractExplicitSkillName(userMessage);

  if (!name) {
    return null;
  }

  return skills.find((skill) => skill.name === name) ?? null;
}

export function extractExplicitSkillName(message: string): string | null {
  const match = message.match(EXPLICIT_SKILL_PATTERN);

  return match?.[1]?.toLowerCase() ?? null;
}
