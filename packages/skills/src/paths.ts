import path from "node:path";
import { getUserConfigDir } from "@tinyclaw/core";

export const SKILL_FILE_NAME = "SKILL.md";
export const SKILL_TOOL_FILES = ["tool.ts", "tool.js"] as const;

export function resolveSkillDiscoveryDirs(options: {
  profileId?: string;
} = {}): string[] {
  const configDir = getUserConfigDir();
  const dirs = [path.join(configDir, "agent", "skills")];

  if (options.profileId) {
    dirs.push(path.join(configDir, "profiles", options.profileId, "skills"));
  }

  return [...new Set(dirs)];
}
