import { join } from "node:path";
import {
  ensureDir,
  writePrivateTextFile,
  writePrivateTextFileIfMissing,
} from "../fs";
import {
  BAD_OUTPUTS_TEMPLATE,
  GOOD_OUTPUTS_TEMPLATE,
  MEMORY_TEMPLATE,
  SKILL_TEMPLATE,
  SOUL_TEMPLATE,
  STYLE_TEMPLATE,
} from "./templates";
import type { InitSoulResult } from "./types";

const INIT_FILES = [
  { path: "SOUL.md", content: SOUL_TEMPLATE },
  { path: "STYLE.md", content: STYLE_TEMPLATE },
  { path: "SKILL.md", content: SKILL_TEMPLATE },
  { path: "MEMORY.md", content: MEMORY_TEMPLATE },
  { path: "examples/good-outputs.md", content: GOOD_OUTPUTS_TEMPLATE },
  { path: "examples/bad-outputs.md", content: BAD_OUTPUTS_TEMPLATE },
] as const;

export async function initSoulDirectory(directory: string): Promise<InitSoulResult> {
  await ensureDir(directory);
  await ensureDir(join(directory, "examples"));
  await ensureDir(join(directory, "data"));
  await ensureDir(join(directory, "data", "knowledge-base", "uploads"));
  await ensureDir(join(directory, "data", "knowledge-base", "extracted"));

  const created: string[] = [];

  for (const file of INIT_FILES) {
    const targetPath = join(directory, file.path);

    if (await writePrivateTextFileIfMissing(targetPath, file.content)) {
      created.push(file.path);
    }
  }

  return { directory, created };
}
