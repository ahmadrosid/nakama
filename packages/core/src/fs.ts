import { randomUUID } from "node:crypto";
import type { Dirent, Mode } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

export const PRIVATE_DIR_MODE = 0o700;

export const PRIVATE_FILE_MODE = 0o600;

const WINDOWS_RENAME_ATTEMPTS = 10;

const WINDOWS_RENAME_RETRY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

/**
 * Windows refuses to replace a file while another handle has it open, which
 * includes a concurrent writer's rename onto the same path, so it fails with
 * EPERM where POSIX rename(2) would just win the race.
 */
async function replaceWithTempFile(
  tempPath: string,
  path: string
): Promise<void> {
  if (process.platform !== "win32") {
    await rename(tempPath, path);

    return;
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(tempPath, path);

      return;
    } catch (error) {
      // SAFETY: Filesystem errors carry errno codes used by this retry policy.
      const code = (error as NodeJS.ErrnoException).code;

      if (
        attempt >= WINDOWS_RENAME_ATTEMPTS ||
        !(code && WINDOWS_RENAME_RETRY_CODES.has(code))
      ) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
    }

    await Bun.sleep(Math.min(attempt * 10, 50));
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(
  path: string,
  mode: Mode = PRIVATE_DIR_MODE
): Promise<void> {
  await mkdir(path, { mode, recursive: true });
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function readTextIfExists(
  path: string
): Promise<string | undefined> {
  if (!(await pathExists(path))) {
    return;
  }

  const content = (await readFile(path, "utf8")).trim();

  return content || undefined;
}

export async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await readText(path);
  } catch {
    return null;
  }
}

export async function readBytes(path: string): Promise<Buffer> {
  return readFile(path);
}

export async function writeTextFile(
  path: string,
  content: string,
  options: {
    mode?: Mode;
    ensureDir?: string;
    ensureDirMode?: Mode;
    chmod?: boolean;
  } = {}
): Promise<void> {
  const mode = options.mode ?? PRIVATE_FILE_MODE;
  const directory = options.ensureDir ?? dirname(path);
  await ensureDir(directory, options.ensureDirMode ?? PRIVATE_DIR_MODE);

  let preserveMode: number | undefined;

  if (options.chmod === false && (await pathExists(path))) {
    // biome-ignore lint/suspicious/noBitwiseOperators: permission bits are stored in st_mode.
    preserveMode = (await stat(path)).mode & 0o777;
  }

  const tempPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, {
    encoding: "utf8",
    mode: preserveMode ?? mode,
  });

  if (options.chmod ?? true) {
    await chmod(tempPath, mode);
  } else if (preserveMode !== undefined) {
    await chmod(tempPath, preserveMode);
  }

  const handle = await open(tempPath, "r+");

  try {
    await handle.sync();
  } finally {
    await handle.close();
  }

  await replaceWithTempFile(tempPath, path);
}

export async function writePrivateTextFileIfMissing(
  path: string,
  content: string
): Promise<boolean> {
  if (await pathExists(path)) {
    return false;
  }

  await writeTextFile(path, content);

  return true;
}

export async function writePrivateBytesFile(
  path: string,
  content: Buffer
): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content, { mode: PRIVATE_FILE_MODE });
}

export async function readDirectoryEntries(path: string): Promise<Dirent[]> {
  return readdir(path, { withFileTypes: true });
}

export async function readDirectory(path: string): Promise<string[]> {
  return readdir(path);
}

export async function readDirectoryOrEmpty(path: string): Promise<string[]> {
  try {
    return await readDirectory(path);
  } catch {
    return [];
  }
}

export async function removeFile(path: string): Promise<void> {
  await unlink(path);
}

export function parseIni(raw: string) {
  const values: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }

    const separator = trimmed.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    values[key] = value;
  }

  return values;
}
