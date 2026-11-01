import type { DiscoveredSkill } from "./types";

export const AGENT_BROWSER_SKILL_NAME = "agent-browser";

export function composeAgentBrowserCapabilityPrompt(
  skills: Pick<DiscoveredSkill, "name">[],
  options: { cloudBrowser?: boolean } = {}
): string {
  const skill = skills.find((entry) => entry.name === AGENT_BROWSER_SKILL_NAME);

  if (!skill) {
    return "";
  }

  return `# Browser automation (agent-browser skill)

The **agent-browser** skill is assigned (see Available Agent Skills). Skills are workflow instructions, not callable tools — run this one with \`bash\` + the agent-browser CLI. For login walls, forms, clicks, screenshots, and dynamic pages; prefer \`web_fetch\` for plain public text.

\`agent-browser open <url>\` → act or \`screenshot artifacts/<file>.png\` → \`close\`. Full workflow: \`load_skill\` with \`agent-browser\`. Missing CLI → tell the operator to install it. Host \`AGENT_BROWSER_EXECUTABLE_PATH\` / \`AGENT_BROWSER_ARGS\` (optional Cloak stealth Chromium) are inherited by bash; if unset, stock Chrome from \`agent-browser install\` is correct.${
    options.cloudBrowser
      ? `

Cloud browser is on. For websites, use the browser_* tools when they are available; they drive the user's own cloud browser.`
      : ""
  }`;
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

export const LOAD_SKILL_TOOL_NAME = "load_skill";

/**
 * The model picks skills from this list and loads one with `load_skill`.
 * Skills that only run on `/skill <name>` stay out of it.
 */
export function composeSkillsCatalog(skills: DiscoveredSkill[]): string {
  const listed = skills.filter((skill) => !skill.disableModelInvocation);

  if (listed.length === 0) {
    return "";
  }

  const lines = [
    "# Available Agent Skills",
    `Workflow skills extend your capabilities for specific tasks. When the user's request matches a skill's description, call \`${LOAD_SKILL_TOOL_NAME}\` with the skill name before you start the task, then follow its instructions. Do not claim to have used a skill based only on its description.`,
    "",
    ...listed.map(
      (skill) =>
        `- **${skill.name}**: ${skill.description}${describeSkillTooling(skill)}${skill.sourceOrganization ? ` (shared from ${JSON.stringify(skill.sourceOrganization.name)}; source is read-only)` : ""}`
    ),
  ];

  return lines.join("\n");
}

/** A skill's full instructions, from `load_skill` or a `/skill <name>` message. */
export function composeLoadedSkillPrompt(skill: DiscoveredSkill): string {
  const location = `Instruction file: ${JSON.stringify(skill.skillFilePath)}. Resolve relative references and assets to full paths from ${JSON.stringify(skill.directory)} and read them with read_file.`;

  const source = skill.sourceOrganization
    ? `Shared from ${JSON.stringify(skill.sourceOrganization.name)}. The source is read-only. Use the published-skill paths only with read_file.`
    : "";

  return [
    `# Active Skill: ${skill.name}`,
    skill.description.trim(),
    source,
    location,
    "Follow the instructions below and read any references they require before starting the task.",
    skill.body.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}
