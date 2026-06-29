import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../fs";
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
      const skillFilePath = path.join(directory, SKILL_FILE_NAME);

      if (!(await pathExists(skillFilePath))) {
        continue;
      }

      try {
        const content = await readFile(skillFilePath, "utf8");
        const parsed = parseSkillMarkdown(content, skillFilePath);
        const toolPath = await findSkillToolPath(directory);

        discovered.set(skillFilePath, {
          name: parsed.frontmatter.name,
          description: parsed.frontmatter.description,
          disableModelInvocation: parsed.frontmatter.disableModelInvocation ?? false,
          includeBodyOnMatch: parsed.frontmatter.includeBodyOnMatch ?? false,
          directory,
          skillFilePath,
          body: parsed.body,
          hasTool: toolPath !== null,
          toolPath,
        });
      } catch (error) {
        console.warn(
          `[tinyclaw:skills] Skipping ${skillFilePath}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  return Array.from(discovered.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
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
