import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_BUNDLED_SKILL_NAMES = ["create-automation", "manage-skills"] as const;
export const SUPER_BOT_BUNDLED_SKILL_NAMES = ["create-profile"] as const;
export const BUNDLED_SKILL_NAMES = [
  ...DEFAULT_BUNDLED_SKILL_NAMES,
  ...SUPER_BOT_BUNDLED_SKILL_NAMES,
] as const;

export type BundledSkillName = (typeof BUNDLED_SKILL_NAMES)[number];

const bundledDir = path.join(path.dirname(fileURLToPath(import.meta.url)));

export async function readBundledSkillMarkdown(name: BundledSkillName): Promise<string> {
  return readFile(path.join(bundledDir, name, "SKILL.md"), "utf8");
}
