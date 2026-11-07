import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import {
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
import { isAbsolute, join, relative, sep } from "node:path";
import { type BackupStatusResponse, NakamaApiError } from "@nakama/core";
import { comparablePath, resolveWithRealpath } from "@nakama/core/tools/paths";
import { z } from "zod";

const MAGIC = Buffer.from("NKBK1\n");

const HEADER_BYTES = MAGIC.length + 12 + 16;

const DAY_MS = 24 * 60 * 60 * 1000;

const KEEP = 7;

const NAME = /^nakama-.+\.zip\.enc$/;

// The last 409 of a scheduled backup, for Settings. The next good backup removes it.
const ERROR_FILE = "scheduled-backup-error.json";

const backupErrorSchema = z.object({ at: z.string(), message: z.string() });

export async function readBackupError(
  dir: string
): Promise<BackupStatusResponse["lastError"]> {
  let raw: string;

  try {
    raw = await readFile(join(dir, ERROR_FILE), "utf8");
  } catch (error) {
    // No file means no recorded 409. Any other read error could hide stopped backups, so log it
    if (getNodeErrorCode(error) !== "ENOENT") {
      console.error(
        `Nakama cannot read ${ERROR_FILE}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return null;
  }

  try {
    const parsed = backupErrorSchema.safeParse(JSON.parse(raw));

    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // Not JSON, logged below like a record of the wrong shape
  }

  console.error(`Nakama cannot read ${ERROR_FILE}: not a backup error record`);

  return null;
}

async function recordBackupError(dir: string, message: string): Promise<void> {
  const path = join(dir, ERROR_FILE);
  const record = { at: new Date().toISOString(), message };
  await writeFile(`${path}.tmp`, JSON.stringify(record), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

export function isEncryptedBackup(data: Uint8Array): boolean {
  return Buffer.from(data).subarray(0, MAGIC.length).equals(MAGIC);
}

export function encryptBackup(zip: Uint8Array, key: Buffer): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(zip), cipher.final()]);

  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), body]);
}

export function decryptBackup(data: Uint8Array, key: Buffer): Buffer {
  const bytes = Buffer.from(data);
  const nonce = bytes.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = bytes.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(bytes.subarray(MAGIC.length + 28)),
    decipher.final(),
  ]);
}

async function writeAll(
  handle: FileHandle,
  data: Uint8Array,
  position: number
): Promise<void> {
  let offset = 0;

  while (offset < data.byteLength) {
    const { bytesWritten } = await handle.write(
      data,
      offset,
      data.byteLength - offset,
      position + offset
    );

    if (bytesWritten === 0) {
      throw new Error("Could not write the backup.");
    }

    offset += bytesWritten;
  }
}

async function readAll(
  handle: FileHandle,
  buffer: Buffer,
  position: number
): Promise<number> {
  let offset = 0;

  while (offset < buffer.byteLength) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.byteLength - offset,
      position + offset
    );

    if (bytesRead === 0) {
      break;
    }

    offset += bytesRead;
  }

  return offset;
}

/** Encrypts a ZIP file into the same `MAGIC + nonce + tag + body` format. */
async function encryptBackupFile(
  sourcePath: string,
  destPath: string,
  key: Buffer
): Promise<void> {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const source = await open(sourcePath, "r");

  try {
    const dest = await open(destPath, "w", 0o600);

    try {
      await writeAll(dest, MAGIC, 0);
      await writeAll(dest, nonce, MAGIC.length);
      // Reserve the GCM tag; it is known only after the final block.
      await writeAll(dest, Buffer.alloc(16), MAGIC.length + 12);

      let position = HEADER_BYTES;
      const input = source.createReadStream({ highWaterMark: 64 * 1024 });

      for await (const chunk of input) {
        const encrypted = cipher.update(chunk);

        if (encrypted.length > 0) {
          await writeAll(dest, encrypted, position);
          position += encrypted.length;
        }
      }

      const final = cipher.final();

      if (final.length > 0) {
        await writeAll(dest, final, position);
      }

      await writeAll(dest, cipher.getAuthTag(), MAGIC.length + 12);
    } finally {
      await dest.close();
    }
  } catch (error) {
    await rm(destPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await source.close();
  }
}

export async function decryptBackupFile(
  sourcePath: string,
  destPath: string,
  key: Buffer
): Promise<void> {
  const source = await open(sourcePath, "r");

  try {
    const header = Buffer.alloc(HEADER_BYTES);
    const headerBytes = await readAll(source, header, 0);

    if (
      headerBytes < HEADER_BYTES ||
      !header.subarray(0, MAGIC.length).equals(MAGIC)
    ) {
      throw new Error("Not an encrypted Nakama backup.");
    }

    const nonce = header.subarray(MAGIC.length, MAGIC.length + 12);
    const tag = header.subarray(MAGIC.length + 12, HEADER_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);

    const dest = await open(destPath, "w", 0o600);

    try {
      let position = 0;

      const input = source.createReadStream({
        highWaterMark: 64 * 1024,
        start: HEADER_BYTES,
      });

      for await (const chunk of input) {
        const decrypted = decipher.update(chunk);

        if (decrypted.length > 0) {
          await writeAll(dest, decrypted, position);
          position += decrypted.length;
        }
      }

      const final = decipher.final();

      if (final.length > 0) {
        await writeAll(dest, final, position);
      }
    } finally {
      await dest.close();
    }
  } catch (error) {
    await rm(destPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await source.close();
  }
}

/** A backup kept inside the data root would be swept into the next export. */
export function assertBackupDirOutsideRoot(dir: string, rootDir: string): void {
  const inside = relative(
    comparablePath(resolveWithRealpath(rootDir)),
    comparablePath(resolveWithRealpath(dir))
  );

  if (
    !(inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
  ) {
    throw new Error(
      `NAKAMA_BACKUP_DIR must be outside the Nakama data root (${rootDir}).`
    );
  }
}

async function listBackups(dir: string): Promise<string[]> {
  // Names carry the UTC time, so a name sort is a time sort.
  return (await readdir(dir)).filter((name) => NAME.test(name)).sort();
}

export interface BackupExportFile {
  cleanup: () => Promise<void>;
  path: string;
}

export async function writeBackup(options: {
  dir: string;
  exportFile: () => Promise<BackupExportFile>;
  key: Buffer;
  now?: Date;
}): Promise<string> {
  const stamp = (options.now ?? new Date())
    .toISOString()
    .replaceAll(":", "")
    .replace(/\.\d+Z$/, "Z");

  const path = join(options.dir, `nakama-${stamp}.zip.enc`);
  const tempPath = `${path}.tmp`;
  const exported = await options.exportFile();

  try {
    await encryptBackupFile(exported.path, tempPath, options.key);

    // Renamed into place, so a crash mid-write never leaves a file that looks complete.
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await exported.cleanup();
  }

  const backups = await listBackups(options.dir);

  for (const old of backups.slice(0, -KEEP)) {
    await unlink(join(options.dir, old));
  }

  return path;
}

/**
 * Writes one backup a day. The first one is due a day after the newest file
 * already in the dir, so a crash loop cannot rotate out a week of good backups.
 */
export async function startScheduledBackups(options: {
  dir: string;
  exportFile: () => Promise<BackupExportFile>;
  key: Buffer;
}): Promise<() => void> {
  await mkdir(options.dir, { mode: 0o700, recursive: true });
  const newest = (await listBackups(options.dir)).at(-1);
  const last = newest ? (await stat(join(options.dir, newest))).mtimeMs : 0;
  let timer: ReturnType<typeof setTimeout>;

  const schedule = (delay: number) => {
    timer = setTimeout(async () => {
      try {
        const path = await writeBackup(options);
        console.log(`Nakama backup written to ${path}`);

        // Its own catch: the backup is written, a failed cleanup must not report it as failed
        try {
          await rm(join(options.dir, ERROR_FILE), { force: true });
        } catch (clearError) {
          console.error(
            `Nakama cannot clear ${ERROR_FILE}: ${clearError instanceof Error ? clearError.message : String(clearError)}`
          );
        }
      } catch (error) {
        console.error(
          `Nakama backup failed: ${error instanceof Error ? error.message : String(error)}`
        );

        if (error instanceof NakamaApiError && error.status === 409) {
          try {
            await recordBackupError(options.dir, error.message);
          } catch (recordError) {
            console.error(
              `Nakama cannot record the backup error: ${recordError instanceof Error ? recordError.message : String(recordError)}`
            );
          }
        }
      }

      schedule(DAY_MS);
    }, delay);
    timer.unref();
  };

  schedule(Math.max(0, last + DAY_MS - Date.now()));

  return () => clearTimeout(timer);
}

function getNodeErrorCode<T>(error: T): string | undefined {
  if (!(error instanceof Error && "code" in error)) {
    return;
  }

  const code = error.code;

  return isString(code) ? code : undefined;
}

function isString<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}
