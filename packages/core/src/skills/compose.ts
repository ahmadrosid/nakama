import type { DiscoveredSkill } from "./types";

export const AGENT_BROWSER_SKILL_NAME = "agent-browser";

export function composeAgentBrowserCapabilityPrompt(
  skills: Pick<DiscoveredSkill, "name">[],
): string {
  const skill = skills.find((entry) => entry.name === AGENT_BROWSER_SKILL_NAME);
  if (!skill) {
    return "";
  }

  return `# Browser automation (agent-browser skill)

The **agent-browser** skill is assigned (see Available Agent Skills). Skills are workflow instructions, not callable tools — run this one with \`bash\` + the agent-browser CLI. For login walls, forms, clicks, screenshots, and dynamic pages; prefer \`web_fetch\` for plain public text.

\`agent-browser open <url>\` → act or \`screenshot artifacts/<file>.png\` → \`close\`. Full workflow: follow the skill when matched or \`/skill agent-browser\`. Missing CLI → tell the operator to install it.`;
}

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
