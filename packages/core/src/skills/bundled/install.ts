import { access, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { writePrivateTextFile, writePrivateTextFileIfMissing } from "../../fs";
import { getGlobalSkillsDir, SKILL_FILE_NAME } from "../paths";
import { BUNDLED_SKILL_NAMES, readBundledSkillMarkdown } from "./index";

const RENAMED_BUNDLED_SKILL_DIRS = [["coding-delegation", "coding-agent"]] as const;

async function migrateRenamedBundledSkillDirectories(): Promise<string[]> {
  const skillsRoot = getGlobalSkillsDir();
  await mkdir(skillsRoot, { recursive: true });
  const refreshed: string[] = [];

  for (const [oldName, newName] of RENAMED_BUNDLED_SKILL_DIRS) {
    const oldDir = path.join(skillsRoot, oldName);
    const newDir = path.join(skillsRoot, newName);

    let oldExists = false;
    try {
      await access(oldDir);
      oldExists = true;
    } catch {
      continue;
    }

    let newExists = false;
    try {
      await access(newDir);
      newExists = true;
    } catch {
      // new directory missing
    }

    if (!newExists) {
      await rename(oldDir, newDir);
    } else {
      await rm(oldDir, { recursive: true, force: true });
    }

    refreshed.push(newName);
  }

  return refreshed;
}

export async function ensureBundledSkillFiles(): Promise<string[]> {
  const created: string[] = [];
  const refreshed = await migrateRenamedBundledSkillDirectories();
  const skillsRoot = getGlobalSkillsDir();
  await mkdir(skillsRoot, { recursive: true });

  for (const name of BUNDLED_SKILL_NAMES) {
    const directory = `${skillsRoot}/${name}`;
    const skillFilePath = `${directory}/${SKILL_FILE_NAME}`;
    const content = await readBundledSkillMarkdown(name);

    if (refreshed.includes(name)) {
      await writePrivateTextFile(skillFilePath, content);
      created.push(name);
      continue;
    }

    if (await writePrivateTextFileIfMissing(skillFilePath, content)) {
      created.push(name);
    }
  }

  return created;
}
