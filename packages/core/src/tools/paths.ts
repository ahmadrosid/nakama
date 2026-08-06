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

export interface PathGuardOptions {
  allowedDirs?: string[];
  maxFileBytes?: number;
  cwd?: string;
}

export class PathGuardError extends Error {
  constructor(
    message: string,
    public readonly code: "TRAVERSAL" | "SPECIAL_FILE" | "NULL_BYTE" | "TOO_LARGE",
  ) {
    super(message);
    this.name = "PathGuardError";
  }
}

const WORKSPACE_TRAVERSAL_MESSAGE =
  "Path outside allowed directories. Use a relative path under the active profile workspace (e.g. SOUL.md or skills/<name>/SKILL.md). Bundled skills are listed in the system prompt and are not readable as arbitrary files.";

export async function guardFilePath(
  rawPath: string,
  rawCwd: string | undefined | null,
  rawContentLength: number | undefined,
  options: PathGuardOptions = {},
): Promise<{ resolved: string; allowed: true }> {
  const rawAllowedDirs = options.allowedDirs ?? [options.cwd ?? process.cwd()];
  const allowedDirs = await resolveAllowedDirs(rawAllowedDirs);
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const defaultCwd = await resolveDirectoryPath(options.cwd ?? process.cwd());

  if (rawPath.includes("\0")) {
    throw new PathGuardError(`Path contains null byte`, "NULL_BYTE");
  }

  if (rawContentLength != null && rawContentLength > maxBytes) {
    throw new PathGuardError(
      `File content exceeds max ${maxBytes} bytes (got ${rawContentLength})`,
      "TOO_LARGE",
    );
  }

  const cwd = resolveSafeCwd(rawCwd, allowedDirs, defaultCwd);
  const expanded = expandHome(rawPath);
  const absolute = path.resolve(cwd, expanded);

  for (const prefix of SPECIAL_PATH_PREFIXES) {
    if (absolute === prefix.slice(0, -1) || absolute.startsWith(prefix)) {
      throw new PathGuardError(`Special filesystem path: ${absolute}`, "SPECIAL_FILE");
    }
  }

  let realPath: string;
  try {
    realPath = await realpath(absolute);
  } catch {
    realPath = await resolvePathThroughExistingParent(absolute);
  }

  if (!isWithinDirs(realPath, allowedDirs)) {
    throw new PathGuardError(WORKSPACE_TRAVERSAL_MESSAGE, "TRAVERSAL");
  }

  return { resolved: realPath, allowed: true };
}

async function resolvePathThroughExistingParent(filePath: string): Promise<string> {
  const resolvedFilePath = path.resolve(filePath);
  let dir = path.dirname(resolvedFilePath);
  const root = path.parse(dir).root;

  while (true) {
    try {
      const resolvedDir = await realpath(dir);
      const relativeDir = path.relative(dir, path.dirname(resolvedFilePath));
      return path.resolve(resolvedDir, relativeDir, path.basename(resolvedFilePath));
    } catch {
      if (dir === root) {
        return resolvedFilePath;
      }
      dir = path.dirname(dir);
    }
  }
}

async function resolveAllowedDirs(dirs: string[]): Promise<string[]> {
  return Promise.all(dirs.map((dir) => resolveDirectoryPath(dir)));
}

async function resolveDirectoryPath(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch {
    return path.resolve(dir);
  }
}

function expandHome(filePath: string): string {
  if (filePath === "~") return getUserHome();
  if (filePath.startsWith("~/")) return path.join(getUserHome(), filePath.slice(2));
  return filePath;
}

function getUserHome(): string {
  return process.env.HOME ?? homedir();
}

function isWithinDirs(target: string, dirs: string[]): boolean {
  const normalized = target.endsWith(path.sep) ? target : target + path.sep;
  for (const dir of dirs) {
    const dirEnd = dir.endsWith(path.sep) ? dir : dir + path.sep;
    if (normalized === dirEnd || normalized.startsWith(dirEnd)) return true;
  }
  return false;
}

function resolveSafeCwd(
  rawCwd: string | undefined | null,
  allowedDirs: string[],
  defaultCwd: string,
): string {
  if (rawCwd == null || rawCwd.trim() === "") return defaultCwd;
  const expanded = expandHome(rawCwd.trim());
  const absolute = path.resolve(expanded);
  return isWithinDirs(absolute, allowedDirs) ? absolute : defaultCwd;
}
