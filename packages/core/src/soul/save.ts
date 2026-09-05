import { join } from "node:path";
import { writeTextFile } from "../fs";
import { SOUL_FILES } from "./load";
import type { SoulStackFiles } from "./types";

export const WRITABLE_SOUL_FILES = SOUL_FILES;

export type WritableSoulFileKey = keyof typeof WRITABLE_SOUL_FILES;

export function isWritableSoulFileKey(key: string): key is WritableSoulFileKey {
  return key in WRITABLE_SOUL_FILES;
}

export async function writeSoulFile(
  directory: string,
  key: WritableSoulFileKey,
  content: string
): Promise<void> {
  await writeTextFile(join(directory, WRITABLE_SOUL_FILES[key]), content, {
    ensureDir: directory,
  });
}

export type { SoulStackFiles };
