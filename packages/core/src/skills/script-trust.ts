import type { ToolDefinition } from "../contract";
import { isGlobalSkillSourcePath } from "./dedupe";
import { isPathWithinProfileSkillsDir } from "./write";

/**
 * What a member-authored skill's tool answers with instead of running. Phrased
 * for the agent and the operator, not only for a server log: a skill whose code
 * is simply absent reads as installed right up to a call that never comes, and
 * the model then answers from the script's text as if it had run.
 */
export const MEMBER_AUTHORED_SKILL_CODE_REFUSAL =
  "This skill's code is not runnable here. Its scripts and tool modules run on the host, so skill write approval must be enabled and an admin must review the exact code files before they run. Answer from the skill's instructions instead.";

/**
 * True when the skill directory sits under one profile's own skills directory,
 * which is where `skill_manage` puts what an org member asks the agent to
 * write. Such a skill's `tool.py` (and its `scripts:` entries) is spawned on
 * the host, so without a gate a member reaches the deployment secret store and
 * every other tenant's workspace through the ordinary tool loop.
 *
 * Global skills ship with the server or an operator installed them, so they
 * are not member-authored.
 */
export function isMemberAuthoredSkillDirectory(options: {
  directory: string;
  orgId: string;
  profileId: string;
}): boolean {
  if (isGlobalSkillSourcePath(options.directory)) {
    return false;
  }
  return isPathWithinProfileSkillsDir(
    options.orgId,
    options.profileId,
    options.directory
  );
}

/**
 * Whether a skill's own code may be loaded as callable tools.
 *
 * Server-shipped skills always may. A profile's own code runs only when write
 * approval is enabled and the caller has verified its files against reviewed
 * proposals. The default leaves the skill readable as instructions.
 */
export function resolveSkillCodeExecutionPolicy(options: {
  directory: string;
  memberAuthoredCodeApproved: boolean;
  orgId: string;
  profileId: string;
}): { executable: true; reason: null } | { executable: false; reason: string } {
  if (
    options.memberAuthoredCodeApproved ||
    !isMemberAuthoredSkillDirectory({
      directory: options.directory,
      orgId: options.orgId,
      profileId: options.profileId,
    })
  ) {
    return { executable: true, reason: null };
  }
  return { executable: false, reason: MEMBER_AUTHORED_SKILL_CODE_REFUSAL };
}

/**
 * A tool shaped exactly like the real one that refuses to run. Registering the
 * refusal keeps the name occupied, so the model is told why the skill's code
 * did nothing instead of retrying an unknown tool or reading the script's text
 * as if it had run.
 */
export function createBlockedSkillCodeTool(options: {
  description: string;
  name: string;
  reason: string;
}): ToolDefinition {
  const { description, name, reason } = options;
  return {
    description,
    name,
    parameters: { additionalProperties: true, type: "object" },
    async run() {
      return { error: reason };
    },
  };
}
