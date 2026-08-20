import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../fs";
import {
  getProfileSkillsArchiveDir,
  getProfileSkillsDir,
  SKILL_ARCHIVE_DIR_NAME,
} from "./paths";
import {
  assertNotBundledSkillName,
  assertValidSkillName,
  isPathWithinProfileSkillsDir,
  resolveProfileSkillDirectory,
} from "./write";

function isUnderArchiveDir(
  orgId: string,
  profileId: string,
  targetPath: string
): boolean {
  const archiveRoot = path.resolve(
    getProfileSkillsArchiveDir(orgId, profileId)
  );
  const resolved = path.resolve(targetPath);
  return (
    resolved === archiveRoot || resolved.startsWith(`${archiveRoot}${path.sep}`)
  );
}

export async function archiveSkillDirectory(options: {
  orgId: string;
  profileId: string;
  skillName: string;
  now?: Date;
}): Promise<{ archivedDirectory: string; skillName: string }> {
  const liveDirectory = resolveProfileSkillDirectory(
    options.orgId,
    options.profileId,
    options.skillName
  );
  // resolveProfileSkillDirectory already assertValidSkillName + assertNotBundledSkillName
  // and keeps liveDirectory inside the profile skills root.
  const skillName = path.basename(liveDirectory);

  if (isUnderArchiveDir(options.orgId, options.profileId, liveDirectory)) {
    throw new Error("Skill is already archived.");
  }

  if (!(await pathExists(liveDirectory))) {
    throw new Error(`Skill "${skillName}" not found.`);
  }

  const archiveRoot = getProfileSkillsArchiveDir(
    options.orgId,
    options.profileId
  );
  await mkdir(archiveRoot, { recursive: true });

  // skillName is a single validated segment from resolveProfileSkillDirectory.
  let archivedDirectory = path.join(archiveRoot, skillName);
  if (await pathExists(archivedDirectory)) {
    const stamp = (options.now ?? new Date()).getTime();
    archivedDirectory = path.join(archiveRoot, `${skillName}-${stamp}`);
  }

  if (
    !archivedDirectory.includes(
      `${path.sep}${SKILL_ARCHIVE_DIR_NAME}${path.sep}`
    )
  ) {
    throw new Error("Archive path must stay under skills/.archive.");
  }

  await rename(liveDirectory, archivedDirectory);

  return { archivedDirectory, skillName };
}

export async function restoreArchivedSkillDirectory(options: {
  orgId: string;
  profileId: string;
  skillName: string;
  archivedDirectory: string;
}): Promise<{ directory: string }> {
  const skillName = assertValidSkillName(options.skillName);
  assertNotBundledSkillName(skillName);

  if (
    !isPathWithinProfileSkillsDir(
      options.orgId,
      options.profileId,
      options.archivedDirectory
    )
  ) {
    throw new Error("Path is outside the profile skills directory.");
  }

  if (
    !isUnderArchiveDir(
      options.orgId,
      options.profileId,
      options.archivedDirectory
    )
  ) {
    throw new Error("Restore path must be under skills/.archive.");
  }

  const liveDirectory = path.join(
    getProfileSkillsDir(options.orgId, options.profileId),
    skillName
  );

  if (await pathExists(liveDirectory)) {
    throw new Error(`Skill "${skillName}" already exists in the live catalog.`);
  }

  await rename(options.archivedDirectory, liveDirectory);
  return { directory: liveDirectory };
}
