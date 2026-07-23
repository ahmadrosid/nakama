import { access, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { writePrivateTextFileIfMissing } from "../../fs";
import { getGlobalSkillsDir, SKILL_FILE_NAME } from "../paths";
import { BUNDLED_SKILL_NAMES, readBundledSkillMarkdown } from "./index";

const RENAMED_BUNDLED_SKILL_DIRS = [["coding-delegation", "coding-agent"]] as const;

async function migrateRenamedBundledSkillDirectories(): Promise<void> {
  const skillsRoot = getGlobalSkillsDir();
  await mkdir(skillsRoot, { recursive: true });

  for (const [oldName, newName] of RENAMED_BUNDLED_SKILL_DIRS) {
    const oldDir = path.join(skillsRoot, oldName);
    const newDir = path.join(skillsRoot, newName);

    try {
      await access(oldDir);
    } catch {
      continue;
    }

    try {
      await access(newDir);
      continue;
    } catch {
      await rename(oldDir, newDir);
    }
  }
}

export async function ensureBundledSkillFiles(): Promise<string[]> {
  const created: string[] = [];
  await migrateRenamedBundledSkillDirectories();
  const skillsRoot = getGlobalSkillsDir();
  await mkdir(skillsRoot, { recursive: true });

  for (const name of BUNDLED_SKILL_NAMES) {
    const directory = `${skillsRoot}/${name}`;
    const skillFilePath = `${directory}/${SKILL_FILE_NAME}`;
    const content = await readBundledSkillMarkdown(name);

    if (await writePrivateTextFileIfMissing(skillFilePath, content)) {
      created.push(name);
    }
  }

  return created;
}
