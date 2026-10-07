import { realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { getUserConfigDir } from "../user-config";

/** Agent-authored tool modules live under {configDir}/tools/. */
export function getCustomToolsDir(): string {
  return path.join(getUserConfigDir(), "tools");
}

// ---------------------------------------------------------------------------
// PathGuard — filesystem safety for LLM-controlled file operations
// ---------------------------------------------------------------------------

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const SPECIAL_PATH_PREFIXES = ["/dev/", "/proc/", "/sys/"];

// On Windows the JS realpathSync keeps the caller's casing and short names;
// the native one returns the on-disk name, as the async realpath already does.
const realpathOnDisk: (filePath: string) => string =
  process.platform === "win32" ? realpathSync.native : realpathSync;

/**
 * NTFS matches names case-insensitively, and the part of a path that does not
 * exist yet keeps whatever casing the caller typed, so containment checks fold
 * case on Windows. POSIX filesystems are case-sensitive and compare as-is.
 */
export function comparablePath(filePath: string): string {
  return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

/**
 * On NTFS a `:` after the drive root names an alternate data stream:
 * `tool.js::$DATA` writes `tool.js` under a name no refusal matches, and
 * `notes 10:30.md` hides its content in a stream of `notes 10`. POSIX allows
 * `:` in file names, so only Windows refuses it.
 */
export function namesAlternateDataStream(absolutePath: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }
  const { root } = path.parse(absolutePath);
  return absolutePath.slice(root.length).includes(":");
}

export interface PathGuardOptions {
  allowedDirs?: string[];
  cwd?: string;
  maxFileBytes?: number;
}

export class PathGuardError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "TRAVERSAL"
      | "SPECIAL_FILE"
      | "NULL_BYTE"
      | "TOO_LARGE"
  ) {
    super(message);
    this.name = "PathGuardError";
  }
}

const WORKSPACE_TRAVERSAL_MESSAGE =
  "Path outside allowed directories. Use a relative path under the active profile workspace (e.g. SOUL.md or skills/<name>/SKILL.md).";

const WORKSPACE_REQUIRED_MESSAGE =
  "workspaceRoot is required; file tools cannot fall back to process.cwd().";

export async function guardFilePath(
  rawPath: string,
  rawCwd: string | undefined | null,
  rawContentLength: number | undefined,
  options: PathGuardOptions = {}
): Promise<{ resolved: string; allowed: true }> {
  const cwdOption = options.cwd?.trim() || null;
  const allowedOption = options.allowedDirs?.filter((dir) => dir.trim()) ?? [];

  let rawAllowedDirs: string[];
  if (allowedOption.length > 0) {
    rawAllowedDirs = allowedOption;
  } else if (cwdOption) {
    rawAllowedDirs = [cwdOption];
  } else {
    throw new PathGuardError(WORKSPACE_REQUIRED_MESSAGE, "TRAVERSAL");
  }

  const allowedDirs = await resolveAllowedDirs(rawAllowedDirs);
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  // rawAllowedDirs is non-empty: either allowedOption or [cwdOption] from above.
  const defaultCwd = await resolveDirectoryPath(cwdOption ?? rawAllowedDirs[0]);

  if (rawPath.includes("\0")) {
    throw new PathGuardError("Path contains null byte", "NULL_BYTE");
  }

  if (rawContentLength != null && rawContentLength > maxBytes) {
    throw new PathGuardError(
      `File content exceeds max ${maxBytes} bytes (got ${rawContentLength})`,
      "TOO_LARGE"
    );
  }

  const cwd = resolveSafeCwd(rawCwd, allowedDirs, defaultCwd);
  const expanded = expandHome(rawPath);
  const absolute = path.resolve(cwd, expanded);

  for (const prefix of SPECIAL_PATH_PREFIXES) {
    if (absolute === prefix.slice(0, -1) || absolute.startsWith(prefix)) {
      throw new PathGuardError(
        `Special filesystem path: ${absolute}`,
        "SPECIAL_FILE"
      );
    }
  }

  if (namesAlternateDataStream(absolute)) {
    throw new PathGuardError(
      `Path names an NTFS alternate data stream: ${absolute}. File names cannot contain ":" on Windows.`,
      "SPECIAL_FILE"
    );
  }

  let realPath: string;
  try {
    realPath = await realpath(absolute);
  } catch {
    realPath = resolveWithRealpath(absolute);
  }

  if (!isAllowedPath(realPath, allowedDirs)) {
    throw new PathGuardError(WORKSPACE_TRAVERSAL_MESSAGE, "TRAVERSAL");
  }

  return { allowed: true, resolved: realPath };
}

/** Realpath when possible; otherwise realpath the deepest existing parent. */
export function resolveWithRealpath(targetPath: string): string {
  const absolute = path.resolve(targetPath);
  try {
    return realpathOnDisk(absolute);
  } catch {
    let dir = path.dirname(absolute);
    const root = path.parse(dir).root;

    while (true) {
      try {
        const resolvedDir = realpathOnDisk(dir);
        const relativeDir = path.relative(dir, path.dirname(absolute));
        return path.resolve(resolvedDir, relativeDir, path.basename(absolute));
      } catch {
        if (dir === root) {
          return absolute;
        }
        dir = path.dirname(dir);
      }
    }
  }
}

export async function resolveWorkspaceRoot(
  rawWorkspaceRoot: string
): Promise<string> {
  if (!path.isAbsolute(rawWorkspaceRoot)) {
    throw new Error(
      "workspaceRoot must be an absolute path; relative roots resolve against process.cwd() and break profile isolation."
    );
  }
  try {
    return await realpath(rawWorkspaceRoot);
  } catch {
    return path.resolve(rawWorkspaceRoot);
  }
}

async function resolveAllowedDirs(dirs: string[]): Promise<string[]> {
  return Promise.all(dirs.map((dir) => resolveDirectoryPath(dir)));
}

async function resolveDirectoryPath(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch {
    return resolveWithRealpath(dir);
  }
}

function expandHome(filePath: string): string {
  if (filePath === "~") {
    return getUserHome();
  }
  if (filePath.startsWith("~/")) {
    return path.join(getUserHome(), filePath.slice(2));
  }
  return filePath;
}

function getUserHome(): string {
  return process.env.HOME ?? homedir();
}

function isAllowedPath(target: string, dirs: string[]): boolean {
  const comparableTarget = comparablePath(target);
  const normalized = comparableTarget.endsWith(path.sep)
    ? comparableTarget
    : comparableTarget + path.sep;
  return dirs.some((rawDir) => {
    const dir = comparablePath(rawDir);
    const dirEnd = dir.endsWith(path.sep) ? dir : dir + path.sep;
    return normalized.startsWith(dirEnd);
  });
}

function resolveSafeCwd(
  rawCwd: string | undefined | null,
  allowedDirs: string[],
  defaultCwd: string
): string {
  if (rawCwd == null || rawCwd.trim() === "") {
    return defaultCwd;
  }
  const expanded = expandHome(rawCwd.trim());
  const absolute = resolveWithRealpath(path.resolve(defaultCwd, expanded));
  if (!isAllowedPath(absolute, allowedDirs)) {
    throw new PathGuardError(
      "Working directory is outside allowed directories. Omit cwd to use the active profile workspace. To read a skill, pass its full instruction path as path and omit cwd.",
      "TRAVERSAL"
    );
  }
  return absolute;
}
