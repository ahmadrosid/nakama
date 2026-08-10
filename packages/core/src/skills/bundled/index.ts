import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUNDLED_SKILL_NAMES,
  type BundledSkillName,
  DEFAULT_BUNDLED_SKILL_NAMES,
  OPT_IN_BUNDLED_SKILL_NAMES,
  RUNTIME_ONLY_BUNDLED_SKILL_NAMES,
  SUPER_BOT_BUNDLED_SKILL_NAMES,
} from "../bundled-names";
import { parseSkillMarkdown } from "../parse";

export {
  BUNDLED_SKILL_NAMES,
  type BundledSkillName,
  DEFAULT_BUNDLED_SKILL_NAMES,
  OPT_IN_BUNDLED_SKILL_NAMES,
  RUNTIME_ONLY_BUNDLED_SKILL_NAMES,
  SUPER_BOT_BUNDLED_SKILL_NAMES,
};

const bundledDir = path.join(path.dirname(fileURLToPath(import.meta.url)));

export async function readBundledSkillMarkdown(
  name: BundledSkillName
): Promise<string> {
  return readFile(path.join(bundledDir, name, "SKILL.md"), "utf8");
}

export async function readBundledSkillBody(
  name: BundledSkillName
): Promise<string> {
  const sourcePath = path.join(bundledDir, name, "SKILL.md");
  return parseSkillMarkdown(await readBundledSkillMarkdown(name), sourcePath)
    .body;
}
