import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../fs";
import { pickPreferredSkillSourcePath } from "./dedupe";
import {
  resolveSkillDiscoveryDirs,
  SKILL_FILE_NAME,
  SKILL_TOOL_FILES,
} from "./paths";
import { parseSkillMarkdown } from "./parse";
import type { DiscoveredSkill } from "./types";

export interface DiscoverSkillsOptions {
  orgId?: string;
  profileId?: string;
}

export async function discoverSkills(
  options: DiscoverSkillsOptions = {},
): Promise<DiscoveredSkill[]> {
  const dirs = await resolveSkillDiscoveryDirs(options);
  const discovered = new Map<string, DiscoveredSkill>();

  for (const rootDir of dirs) {
    if (!(await pathExists(rootDir))) {
      continue;
    }

    const entries = await readdir(rootDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
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
        skill.directory,
      );

      if (preferredDirectory === skill.directory) {
        discovered.set(skill.name, skill);
      }
    }
  }

  return Array.from(discovered.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export async function discoverSkillDirectory(
  directory: string,
): Promise<DiscoveredSkill | null> {
  const skillFilePath = path.join(directory, SKILL_FILE_NAME);

  if (!(await pathExists(skillFilePath))) {
    return null;
  }

  try {
    const content = await readFile(skillFilePath, "utf8");
    const parsed = parseSkillMarkdown(content, skillFilePath);
    const toolPath = await findSkillToolPath(directory);

    return {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      disableModelInvocation: parsed.frontmatter.disableModelInvocation ?? false,
      includeBodyOnMatch: parsed.frontmatter.includeBodyOnMatch ?? false,
      directory,
      skillFilePath,
      body: parsed.body,
      hasTool: toolPath !== null,
      toolPath,
    };
  } catch (error) {
    console.warn(
      `[nakama:skills] Skipping ${skillFilePath}:`,
      error instanceof Error ? error.message : error,
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
