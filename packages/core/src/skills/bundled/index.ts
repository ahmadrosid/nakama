import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillMarkdown } from "../parse";
import {
  BUNDLED_SKILL_NAMES,
  DEFAULT_BUNDLED_SKILL_NAMES,
  RUNTIME_ONLY_BUNDLED_SKILL_NAMES,
  SUPER_BOT_BUNDLED_SKILL_NAMES,
  type BundledSkillName,
} from "../bundled-names";

export {
  BUNDLED_SKILL_NAMES,
  DEFAULT_BUNDLED_SKILL_NAMES,
  RUNTIME_ONLY_BUNDLED_SKILL_NAMES,
  SUPER_BOT_BUNDLED_SKILL_NAMES,
  type BundledSkillName,
};

const bundledDir = path.join(path.dirname(fileURLToPath(import.meta.url)));

export async function readBundledSkillMarkdown(name: BundledSkillName): Promise<string> {
  return readFile(path.join(bundledDir, name, "SKILL.md"), "utf8");
}

export async function readBundledSkillBody(name: BundledSkillName): Promise<string> {
  const sourcePath = path.join(bundledDir, name, "SKILL.md");
  return parseSkillMarkdown(await readBundledSkillMarkdown(name), sourcePath).body;
}
