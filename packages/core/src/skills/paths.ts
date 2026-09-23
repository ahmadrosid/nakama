import path from "node:path";
import { getProfileSoulDir } from "../soul/resolve";
import { getUserConfigDir } from "../user-config";

export const SKILL_FILE_NAME = "SKILL.md";
export const SKILL_TOOL_FILES = ["tool.ts", "tool.js", "tool.py"] as const;
export const SKILL_ARCHIVE_DIR_NAME = ".archive";

export function getGlobalSkillsDir(): string {
  return path.join(getUserConfigDir(), "agent", "skills");
}

export function getProfileSkillsDir(orgId: string, profileId: string): string {
  return path.join(getProfileSoulDir(orgId, profileId), "skills");
}

export function getProfileSkillsArchiveDir(
  orgId: string,
  profileId: string
): string {
  return path.join(
    getProfileSkillsDir(orgId, profileId),
    SKILL_ARCHIVE_DIR_NAME
  );
}

export async function resolveSkillDiscoveryDirs(
  options: { orgId?: string; profileId?: string } = {}
): Promise<string[]> {
  const orgId = options.orgId?.trim();
  const profileId = options.profileId?.trim();
  if (Boolean(orgId) !== Boolean(profileId)) {
    throw new Error(
      "resolveSkillDiscoveryDirs requires both orgId and profileId, or neither."
    );
  }

  const dirs = [getGlobalSkillsDir()];

  if (orgId && profileId) {
    dirs.push(getProfileSkillsDir(orgId, profileId));
  }

  return [...new Set(dirs)];
}
