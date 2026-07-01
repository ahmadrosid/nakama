import { join } from "node:path";
import {
  ensureDir,
  pathExists,
  readText,
  writePrivateTextFile,
} from "../fs";
import {
  BAD_OUTPUTS_TEMPLATE,
  GOOD_OUTPUTS_TEMPLATE,
  INSTRUCTIONS_TEMPLATE,
  MEMORY_TEMPLATE,
  SOUL_TEMPLATE,
  STYLE_TEMPLATE,
} from "./templates";
import type { InitSoulResult } from "./types";

const INIT_FILES = [
  { path: "SOUL.md", content: SOUL_TEMPLATE },
  { path: "STYLE.md", content: STYLE_TEMPLATE },
  { path: "INSTRUCTIONS.md", content: INSTRUCTIONS_TEMPLATE },
  { path: "MEMORY.md", content: MEMORY_TEMPLATE },
  { path: "examples/good-outputs.md", content: GOOD_OUTPUTS_TEMPLATE },
  { path: "examples/bad-outputs.md", content: BAD_OUTPUTS_TEMPLATE },
] as const;

const LEGACY_SOUL_MARKERS = ["# Your Name", "[Your Name]", "[Belief 1]"] as const;

export function isLegacySoulPlaceholder(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return true;
  }

  return LEGACY_SOUL_MARKERS.some((marker) => trimmed.includes(marker));
}

function shouldSeedSoulFile(relativePath: string, existingContent: string | undefined): boolean {
  if (!existingContent?.trim()) {
    return true;
  }

  if (relativePath === "SOUL.md") {
    return isLegacySoulPlaceholder(existingContent);
  }

  return false;
}

async function readExistingSoulFile(path: string): Promise<string | undefined> {
  if (!(await pathExists(path))) {
    return undefined;
  }

  return readText(path);
}

async function ensureSoulTemplateFile(
  targetPath: string,
  relativePath: string,
  content: string,
): Promise<boolean> {
  const existing = await readExistingSoulFile(targetPath);

  if (!shouldSeedSoulFile(relativePath, existing)) {
    return false;
  }

  await writePrivateTextFile(targetPath, content);
  return true;
}

export async function initSoulDirectory(directory: string): Promise<InitSoulResult> {
  await ensureDir(directory);
  await ensureDir(join(directory, "examples"));
  await ensureDir(join(directory, "knowledge-base"));
  await ensureDir(join(directory, "memory-archive"));

  const created: string[] = [];

  for (const file of INIT_FILES) {
    const targetPath = join(directory, file.path);

    if (await ensureSoulTemplateFile(targetPath, file.path, file.content)) {
      created.push(file.path);
    }
  }

  return { directory, created };
}
