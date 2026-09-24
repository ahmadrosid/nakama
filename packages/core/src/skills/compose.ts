import type { DiscoveredSkill } from "./types";

export const AGENT_BROWSER_SKILL_NAME = "agent-browser";

export function composeAgentBrowserCapabilityPrompt(
  skills: Pick<DiscoveredSkill, "name">[]
): string {
  const skill = skills.find((entry) => entry.name === AGENT_BROWSER_SKILL_NAME);
  if (!skill) {
    return "";
  }

  return `# Browser automation (agent-browser skill)

The **agent-browser** skill is assigned (see Available Agent Skills). Skills are workflow instructions, not callable tools — run this one with \`bash\` + the agent-browser CLI. For login walls, forms, clicks, screenshots, and dynamic pages; prefer \`web_fetch\` for plain public text.

\`agent-browser open <url>\` → act or \`screenshot artifacts/<file>.png\` → \`close\`. Full workflow: follow the skill when matched or \`/skill agent-browser\`. Missing CLI → tell the operator to install it. Host \`AGENT_BROWSER_EXECUTABLE_PATH\` / \`AGENT_BROWSER_ARGS\` (optional Cloak stealth Chromium) are inherited by bash; if unset, stock Chrome from \`agent-browser install\` is correct.`;
}

/**
 * A skill that ships code nothing here can run used to read exactly like a
 * prose-only skill. Its SKILL.md still says to run the script, so the model
 * followed the instructions, found no tool, and answered from the source it
 * had just read. Saying it out loud is what stops that.
 */
function describeSkillTooling(skill: DiscoveredSkill): string {
  if (skill.hasTool) {
    return " (includes tool)";
  }
  const count = skill.scriptIssues.length;
  if (count === 0) {
    return "";
  }
  return ` (ships ${count} script${count === 1 ? "" : "s"} that cannot run here; do not answer from their source, say they are unavailable)`;
}

export function composeSkillsCatalog(skills: DiscoveredSkill[]): string {
  if (skills.length === 0) {
    return "";
  }

  const lines = [
    "# Available Agent Skills",
    "Workflow skills extend your capabilities for specific tasks. Follow a skill's instructions when it matches the user's request.",
    "Before using a skill, read its SKILL.md with read_file unless its full instructions are already included below. Follow any required references before producing the deliverable. Do not claim to have used a skill based only on its description.",
    "Use the full instruction path shown below as read_file's path and omit cwd. Do not shorten it to a relative path. For references and assets, build the full path from the skill directory and omit cwd.",
    "",
    ...skills.map(
      (skill) =>
        `- **${skill.name}**: ${skill.description}${describeSkillTooling(skill)} (instructions: ${JSON.stringify(skill.skillFilePath)})`
    ),
  ];

  return lines.join("\n");
}

export function composeMatchedSkillsPrompt(
  skills: DiscoveredSkill[],
  options: { explicitInvocation?: boolean } = {}
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

    const location = `Instruction file: ${JSON.stringify(skill.skillFilePath)}. Pass this full path to read_file and omit cwd. Resolve relative references and assets to full paths from ${JSON.stringify(skill.directory)} and omit cwd for those reads too.`;
    const loading = includeBody
      ? "Follow the instructions below and read any references they require before starting the task."
      : "Before starting the task, use read_file to read the full instruction file, then read any references it requires. This description is not the full skill. If the instructions cannot be read, report the problem instead of claiming to use the skill.";

    return [header, description, location, loading, body]
      .filter(Boolean)
      .join("\n");
  });

  return ["# Active Skills", ...sections].join("\n\n");
}
