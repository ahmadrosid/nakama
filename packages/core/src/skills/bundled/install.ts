import { access, copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { writePrivateTextFileIfMissing, writeTextFile } from "../../fs";
import { getGlobalSkillsDir, SKILL_FILE_NAME } from "../paths";
import {
  BUNDLED_SKILL_NAMES,
  bundledSkillDirectory,
  readBundledSkillMarkdown,
} from "./index";

/** Bundled skills whose installed SKILL.md must be overwritten on startup (content drift). */
const FORCE_REFRESH_BUNDLED_SKILL_NAMES = new Set<string>([
  "manage-skills",
  "coding-agent",
  "composio-integrations",
  "create-plugin",
  "coding-backend-codex",
  "coding-backend-cursor",
  "agent-browser",
  "artifact-design",
  "slide-deck-design",
  "archive-profile-memory",
  "nakama-guide",
]);

const RENAMED_BUNDLED_SKILL_DIRS = [
  ["coding-delegation", "coding-agent"],
  ["save-artifact", "artifact-design"],
] as const;

async function migrateRenamedBundledSkillDirectories(): Promise<string[]> {
  const skillsRoot = getGlobalSkillsDir();
  await mkdir(skillsRoot, { recursive: true });
  const refreshed: string[] = [];

  for (const [oldName, newName] of RENAMED_BUNDLED_SKILL_DIRS) {
    const oldDir = path.join(skillsRoot, oldName);
    const newDir = path.join(skillsRoot, newName);

    try {
      await access(oldDir);
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

    if (newExists) {
      await rm(oldDir, { force: true, recursive: true });
    } else {
      await rename(oldDir, newDir);
    }

    refreshed.push(newName);
  }

  return refreshed;
}

/** Scripts and templates beside SKILL.md are read-only assets; always refresh them. */
async function copyBundledSkillAssets(
  name: (typeof BUNDLED_SKILL_NAMES)[number],
  directory: string
): Promise<void> {
  const source = bundledSkillDirectory(name);

  const entries = await readdir(source, {
    recursive: true,
    withFileTypes: true,
  });

  for (const entry of entries) {
    const from = path.join(entry.parentPath, entry.name);
    const relative = path.relative(source, from);

    if (!entry.isFile() || relative === SKILL_FILE_NAME) {
      continue;
    }

    const to = path.join(directory, relative);
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
  }
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
    await copyBundledSkillAssets(name, directory);

    if (
      refreshed.includes(name) ||
      FORCE_REFRESH_BUNDLED_SKILL_NAMES.has(name)
    ) {
      await writeTextFile(skillFilePath, content);
      created.push(name);
      continue;
    }

    if (await writePrivateTextFileIfMissing(skillFilePath, content)) {
      created.push(name);
    }
  }

  return created;
}
