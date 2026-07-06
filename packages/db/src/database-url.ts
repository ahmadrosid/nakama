import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { getUserConfigDir } from "@nakama/core";

export interface ResolveDatabasePathOptions {
  /** Anchor relative file: paths (defaults to ~/.nakama). */
  baseDir?: string;
}

export function resolveDatabasePath(
  databaseUrl: string,
  options: ResolveDatabasePathOptions = {},
): string {
  const trimmed = databaseUrl.trim();

  if (trimmed === ":memory:" || trimmed === "memory:") {
    return ":memory:";
  }

  const withoutScheme = trimmed.startsWith("file:")
    ? trimmed.slice("file:".length)
    : trimmed;

  if (isAbsolute(withoutScheme)) {
    return withoutScheme;
  }

  const baseDir = options.baseDir?.trim() || getUserConfigDir();

  return resolve(baseDir, withoutScheme);
}

export function ensureDatabaseDirectory(databasePath: string): void {
  if (databasePath === ":memory:") {
    return;
  }

  mkdirSync(dirname(databasePath), { recursive: true });
}
