import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function initSoulDirectory(directory: string): Promise<InitSoulResult> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await mkdir(join(directory, "examples"), { recursive: true, mode: 0o700 });
  await mkdir(join(directory, "data"), { recursive: true, mode: 0o700 });

  const created: string[] = [];

  for (const file of INIT_FILES) {
    const targetPath = join(directory, file.path);

    if (await fileExists(targetPath)) {
      continue;
    }

    await writeFile(targetPath, file.content, { encoding: "utf8", mode: 0o600 });
    created.push(file.path);
  }

  return { directory, created };
}
