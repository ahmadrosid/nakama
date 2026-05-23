import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SoulStackFiles } from "./types";

const WRITABLE_SOUL_FILES = {
  soul: "SOUL.md",
  style: "STYLE.md",
  skill: "SKILL.md",
  memory: "MEMORY.md",
} as const;

export type WritableSoulFileKey = keyof typeof WRITABLE_SOUL_FILES;

export function isWritableSoulFileKey(key: string): key is WritableSoulFileKey {
  return key in WRITABLE_SOUL_FILES;
}

export async function writeSoulFile(
  directory: string,
  key: WritableSoulFileKey,
  content: string,
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, WRITABLE_SOUL_FILES[key]), content, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export type { SoulStackFiles };
