import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getGroupMemoryPath } from "@nakama/core";

/** Longest memory members see, the same cap as a profile's MEMORY.md. */
export const GROUP_MEMORY_CHARS = 4096;

/** The group's memory, or "" when it has none. */
export function readGroupMemory(sharedDir: string): string {
  const path = getGroupMemoryPath(sharedDir);

  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
}

export function writeGroupMemory(sharedDir: string, content: string): void {
  const path = getGroupMemoryPath(sharedDir);
  const trimmed = content.trim();

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, trimmed ? `${trimmed}\n` : "");
}
