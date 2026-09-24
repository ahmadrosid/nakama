import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../fs";
import { pickPreferredSkillSourcePath } from "./dedupe";
import { parseSkillMarkdown } from "./parse";
import {
  resolveSkillDiscoveryDirs,
  SKILL_ARCHIVE_DIR_NAME,
  SKILL_FILE_NAME,
  SKILL_TOOL_FILES,
} from "./paths";
import { resolveSkillScripts } from "./script-tools";
import type { DiscoveredSkill } from "./types";

/**
 * Discovery runs on every session build, so a skill is only reported once per
 * process. Without this the operator never learns the script is dead weight:
 * the old behaviour surfaced nothing at all, and the model quietly answered
 * from the script's text instead of running it.
 */
const warnedSkillDirectories = new Set<string>();

function warnAboutUnrunnableScripts(
  directory: string,
  issues: { path: string; reason: string }[]
): void {
  if (issues.length === 0 || warnedSkillDirectories.has(directory)) {
    return;
  }
  warnedSkillDirectories.add(directory);
  for (const issue of issues) {
    console.warn(
      `[nakama:skills] ${directory}: ${issue.path} ${issue.reason}.`
    );
  }
}

export interface DiscoverSkillsOptions {
  orgId?: string;
  profileId?: string;
}

export async function discoverSkills(
  options: DiscoverSkillsOptions = {}
): Promise<DiscoveredSkill[]> {
  const dirs = await resolveSkillDiscoveryDirs(options);
  const discovered = new Map<string, DiscoveredSkill>();

  for (const rootDir of dirs) {
    if (!(await pathExists(rootDir))) {
      continue;
    }

    const entries = await readdir(rootDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === SKILL_ARCHIVE_DIR_NAME) {
        continue;
      }

      const directory = path.join(rootDir, entry.name);
      const skill = await discoverSkillDirectory(directory);

      if (!skill) {
        continue;
      }

      const existing = discovered.get(skill.name);

      if (!existing) {
        discovered.set(skill.name, skill);
        continue;
      }

      const preferredDirectory = pickPreferredSkillSourcePath(
        existing.directory,
        skill.directory
      );

      if (preferredDirectory === skill.directory) {
        discovered.set(skill.name, skill);
      }
    }
  }

  return Array.from(discovered.values()).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

export async function discoverSkillDirectory(
  directory: string
): Promise<DiscoveredSkill | null> {
  const skillFilePath = path.join(directory, SKILL_FILE_NAME);

  if (!(await pathExists(skillFilePath))) {
    return null;
  }

  try {
    const content = await readFile(skillFilePath, "utf8");
    const parsed = parseSkillMarkdown(content, skillFilePath);
    const toolPath = await findSkillToolPath(directory);
    const scripts = await resolveSkillScripts({
      declared: parsed.frontmatter.scripts ?? [],
      directory,
      skillName: parsed.frontmatter.name,
      toolPath,
    });
    warnAboutUnrunnableScripts(directory, scripts.issues);

    return {
      body: parsed.body,
      description: parsed.frontmatter.description,
      directory,
      disableModelInvocation:
        parsed.frontmatter.disableModelInvocation ?? false,
      hasTool: toolPath !== null || scripts.tools.length > 0,
      includeBodyOnMatch: parsed.frontmatter.includeBodyOnMatch ?? false,
      name: parsed.frontmatter.name,
      scriptIssues: scripts.issues,
      scriptTools: scripts.tools,
      skillFilePath,
      toolPath,
    };
  } catch (error) {
    console.warn(
      `[nakama:skills] Skipping ${skillFilePath}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

async function findSkillToolPath(directory: string): Promise<string | null> {
  for (const fileName of SKILL_TOOL_FILES) {
    const candidate = path.join(directory, fileName);

    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}
