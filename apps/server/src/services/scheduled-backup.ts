import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
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

const DAY_MS = 24 * 60 * 60 * 1000;

const KEEP = 7;

const NAME = /^nakama-.+\.zip\.enc$/;

// The last failed scheduled backup, for Settings. The next good backup removes it.
const ERROR_FILE = "scheduled-backup-error.json";

// A record is one short message; anything bigger is not ours.
const MAX_ERROR_FILE_BYTES = 16 * 1024;

const backupErrorSchema = z.object({
  at: z.iso.datetime(),
  message: z.string(),
});

/** Throws when the record exists but cannot be read, so Settings shows that it cannot check. */
export async function readBackupError(
  dir: string
): Promise<BackupStatusResponse["lastError"]> {
  const path = join(dir, ERROR_FILE);
  let info: Awaited<ReturnType<typeof lstat>>;

  try {
    info = await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw new NakamaApiError(
      `Cannot read ${ERROR_FILE}: ${describe(error)}`,
      500
    );
  }

  if (!info.isFile() || info.size > MAX_ERROR_FILE_BYTES) {
    throw new NakamaApiError(
      `Cannot read ${ERROR_FILE}: not a backup error record.`,
      500
    );
  }

  const parsed = backupErrorSchema.safeParse(
    await readFile(path, "utf8")
      .then(JSON.parse)
      .catch(() => null)
  );

  if (!parsed.success) {
    throw new NakamaApiError(
      `Cannot read ${ERROR_FILE}: not a backup error record.`,
      500
    );
  }

  return parsed.data;
}

/** Renamed into place, so a crash mid-write never leaves a file that looks complete. */
async function writeAtomically(path: string, data: Uint8Array | string) {
  try {
    await writeFile(`${path}.tmp`, data, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  } catch (error) {
    await rm(`${path}.tmp`, { force: true });
    throw error;
  }
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

export async function writeBackup(options: {
  dir: string;
  exportZip: () => Promise<Uint8Array>;
  key: Buffer;
  now?: Date;
}): Promise<string> {
  const stamp = (options.now ?? new Date())
    .toISOString()
    .replaceAll(":", "")
    .replace(/\.\d+Z$/, "Z");

  const path = join(options.dir, `nakama-${stamp}.zip.enc`);
  const data = encryptBackup(await options.exportZip(), options.key);

  await writeAtomically(path, data);

  const backups = await listBackups(options.dir);

  for (const old of backups.slice(0, -KEEP)) {
    await unlink(join(options.dir, old));
  }

  return path;
}

/**
 * Writes one backup a day. The first one is due a day after the newest file
 * already in the dir, so a crash loop cannot rotate out a week of good backups.
 * The returned stop waits for a run that already started.
 */
export async function startScheduledBackups(options: {
  dir: string;
  exportZip: () => Promise<Uint8Array>;
  key: Buffer;
}): Promise<() => Promise<void>> {
  await mkdir(options.dir, { mode: 0o700, recursive: true });
  const newest = (await listBackups(options.dir)).at(-1);
  const last = newest ? (await stat(join(options.dir, newest))).mtimeMs : 0;
  let timer: ReturnType<typeof setTimeout>;
  let running: Promise<void> = Promise.resolve();
  let stopped = false;

  const run = async () => {
    const errorPath = join(options.dir, ERROR_FILE);

    try {
      const path = await writeBackup(options);
      console.log(`Nakama backup written to ${path}`);

      // Its own catch: the backup is written, a failed cleanup must not report it as failed
      try {
        await rm(errorPath, { force: true });
      } catch (clearError) {
        console.error(
          `Nakama cannot clear ${ERROR_FILE}: ${describe(clearError)}`
        );
      }
    } catch (error) {
      console.error(`Nakama backup failed: ${describe(error)}`);

      // Every failure replaces the record, so Settings always shows the last run.
      // Only a NakamaApiError is written for an admin; other details stay in the log.
      const message =
        error instanceof NakamaApiError
          ? error.message
          : "The scheduled backup failed. The server log has the details.";

      try {
        await writeAtomically(
          errorPath,
          JSON.stringify({ at: new Date().toISOString(), message })
        );
      } catch (recordError) {
        console.error(
          `Nakama cannot record the backup error: ${describe(recordError)}`
        );
      }
    }
  };

  const schedule = (delay: number) => {
    timer = setTimeout(() => {
      running = run().then(() => {
        if (!stopped) {
          schedule(DAY_MS);
        }
      });
    }, delay);
    timer.unref();
  };

  schedule(Math.max(0, last + DAY_MS - Date.now()));

  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}

function describe<T>(error: T): string {
  return error instanceof Error ? error.message : String(error);
}
