import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillMarkdown } from "../parse";

export const DEFAULT_BUNDLED_SKILL_NAMES = [
  "create-automation",
  "manage-skills",
  "update-profile-memory",
  "archive-profile-memory",
  "save-artifact",
] as const;
export const SUPER_BOT_BUNDLED_SKILL_NAMES = ["create-profile", "coding-delegation"] as const;
export const RUNTIME_ONLY_BUNDLED_SKILL_NAMES = [
  "coding-backend-codex",
  "coding-backend-claude-code",
  "coding-backend-opencode",
] as const;
export const BUNDLED_SKILL_NAMES = [
  ...DEFAULT_BUNDLED_SKILL_NAMES,
  ...SUPER_BOT_BUNDLED_SKILL_NAMES,
  ...RUNTIME_ONLY_BUNDLED_SKILL_NAMES,
] as const;

export type BundledSkillName = (typeof BUNDLED_SKILL_NAMES)[number];

const bundledDir = path.join(path.dirname(fileURLToPath(import.meta.url)));

export async function readBundledSkillMarkdown(name: BundledSkillName): Promise<string> {
  return readFile(path.join(bundledDir, name, "SKILL.md"), "utf8");
}

export async function readBundledSkillBody(name: BundledSkillName): Promise<string> {
  const sourcePath = path.join(bundledDir, name, "SKILL.md");
  return parseSkillMarkdown(await readBundledSkillMarkdown(name), sourcePath).body;
}
