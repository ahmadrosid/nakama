import { chmodSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { getUserConfigDir, PRIVATE_DIR_MODE } from "@nakama/core";

export interface ResolveDatabasePathOptions {
  /** Anchor relative file: paths (defaults to ~/.nakama). */
  baseDir?: string;
}

export function resolveDatabasePath(
  databaseUrl: string,
  options: ResolveDatabasePathOptions = {}
): string {
  const trimmed = databaseUrl.trim();

  if (trimmed === ":memory:") {
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
  if (!isAbsolute(databasePath)) {
    throw new Error("Database path must be absolute.");
  }

  const directory = dirname(databasePath);
  mkdirSync(directory, { mode: PRIVATE_DIR_MODE, recursive: true });
  // mkdir masks a new directory's mode with the umask and leaves an existing
  // one alone, so re-tighten instead of trusting creation.
  chmodSync(directory, PRIVATE_DIR_MODE);
}
