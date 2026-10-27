import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const MAGIC = Buffer.from("NKBK1\n");

const DAY_MS = 24 * 60 * 60 * 1000;

const KEEP = 7;

const NAME = /^nakama-.+\.zip\.enc$/;

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
  const inside = relative(resolve(rootDir), resolve(dir));

  if (!(inside.startsWith("..") || isAbsolute(inside))) {
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

  // Renamed into place, so a crash mid-write never leaves a file that looks complete.
  await writeFile(`${path}.tmp`, data, { mode: 0o600 });
  await rename(`${path}.tmp`, path);

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
  exportZip: () => Promise<Uint8Array>;
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
      } catch (error) {
        console.error(
          `Nakama backup failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      schedule(DAY_MS);
    }, delay);
    timer.unref();
  };

  schedule(Math.max(0, last + DAY_MS - Date.now()));

  return () => clearTimeout(timer);
}
