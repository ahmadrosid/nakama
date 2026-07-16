import path from "node:path";
import { getUserConfigDir } from "../user-config";

export const SKILL_FILE_NAME = "SKILL.md";
export const SKILL_TOOL_FILES = ["tool.ts", "tool.js"] as const;

export function getGlobalSkillsDir(): string {
  return path.join(getUserConfigDir(), "agent", "skills");
}

export function getProfileSkillsDir(orgId: string, profileId: string): string {
  return path.join(getUserConfigDir(), "orgs", orgId, "profiles", profileId, "skills");
}

export async function resolveSkillDiscoveryDirs(options: {
  orgId?: string;
  profileId?: string;
} = {}): Promise<string[]> {
  const dirs = [getGlobalSkillsDir()];

  if (options.orgId && options.profileId) {
    dirs.push(getProfileSkillsDir(options.orgId, options.profileId));
  }

  return [...new Set(dirs)];
}
