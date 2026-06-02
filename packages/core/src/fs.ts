import {
  access,
  chmod,
  mkdir,
  readdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import type { Dirent, Mode } from "node:fs";
import { dirname } from "node:path";

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

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
  mode: Mode = PRIVATE_DIR_MODE,
): Promise<void> {
  await mkdir(path, { recursive: true, mode });
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function readTextIfExists(path: string): Promise<string | undefined> {
  if (!(await pathExists(path))) {
    return undefined;
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
  } = {},
): Promise<void> {
  const mode = options.mode ?? PRIVATE_FILE_MODE;
  const directory = options.ensureDir ?? dirname(path);
  await ensureDir(directory, options.ensureDirMode ?? PRIVATE_DIR_MODE);
  await writeFile(path, content, { encoding: "utf8", mode });

  if (options.chmod ?? mode === PRIVATE_FILE_MODE) {
    await chmod(path, mode);
  }
}

export async function writePrivateTextFile(
  path: string,
  content: string,
  options: { ensureDir?: string } = {},
): Promise<void> {
  await writeTextFile(path, content, options);
}

export async function writePrivateTextFileIfMissing(
  path: string,
  content: string,
): Promise<boolean> {
  if (await pathExists(path)) {
    return false;
  }

  await writePrivateTextFile(path, content);
  return true;
}

export async function writePrivateBytesFile(path: string, content: Buffer): Promise<void> {
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
