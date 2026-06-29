import type { DiscoveredSkill } from "./types";

export function composeSkillsCatalog(skills: DiscoveredSkill[]): string {
  if (skills.length === 0) {
    return "";
  }

  const lines = [
    "# Available Agent Skills",
    "Workflow skills extend your capabilities for specific tasks. Follow a skill's instructions when it matches the user's request.",
    "Invoke a skill explicitly with `/skill <name>` when needed.",
    "",
    ...skills.map(
      (skill) =>
        `- **${skill.name}**: ${skill.description}${skill.hasTool ? " (includes tool)" : ""}`,
    ),
  ];

  return lines.join("\n");
}

export function composeMatchedSkillsPrompt(
  skills: DiscoveredSkill[],
  options: { explicitInvocation?: boolean } = {},
): string {
  if (skills.length === 0) {
    return "";
  }

  const explicitInvocation = options.explicitInvocation ?? false;
  const sections = skills.map((skill) => {
    const header = `# Active Skill: ${skill.name}`;
    const description = skill.description.trim();
    const includeBody = explicitInvocation || skill.includeBodyOnMatch;
    const body = includeBody ? skill.body.trim() : "";

    return [header, description, "", body].filter(Boolean).join("\n");
  });

  return ["# Active Skills", ...sections].join("\n\n");
}
