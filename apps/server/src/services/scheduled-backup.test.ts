import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeArchiveRequestData } from "./data-portability";
import {
  assertBackupDirOutsideRoot,
  encryptBackup,
  startScheduledBackups,
  writeBackup,
} from "./scheduled-backup";

const key = randomBytes(32);

const dirs: string[] = [];

const savedKey = process.env.NAKAMA_SECRETS_KEY;

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nakama-backup-"));
  dirs.push(dir);

  return dir;
}

afterEach(async () => {
  if (savedKey === undefined) {
    delete process.env.NAKAMA_SECRETS_KEY;
  } else {
    process.env.NAKAMA_SECRETS_KEY = savedKey;
  }

  for (const dir of dirs.splice(0)) {
    await rm(dir, { force: true, recursive: true });
  }
});

describe("scheduled backups", () => {
  test("import decrypts a backup with the current key and refuses another key", () => {
    const zip = Buffer.from("PK zip bytes");
    const data = encryptBackup(zip, key).toString("base64");

    process.env.NAKAMA_SECRETS_KEY = key.toString("base64");
    expect(decodeArchiveRequestData(data)).toEqual(zip);

    process.env.NAKAMA_SECRETS_KEY = randomBytes(32).toString("base64");
    expect(() => decodeArchiveRequestData(data)).toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  test("keeps the newest seven backups", async () => {
    const dir = await tempDir();

    for (let day = 1; day <= 9; day += 1) {
      await writeBackup({
        dir,
        exportZip: async () => Buffer.from(`day ${day}`),
        key,
        now: new Date(Date.UTC(2026, 9, day)),
      });
    }

    const names = await readdir(dir);
    expect(names).toHaveLength(7);
    expect(names.sort()[0]).toBe("nakama-2026-10-03T000000Z.zip.enc");
  });

  test("refuses a backup dir inside the data root", () => {
    expect(() =>
      assertBackupDirOutsideRoot("/srv/nakama/backups", "/srv/nakama")
    ).toThrow();
    expect(() =>
      assertBackupDirOutsideRoot("/srv/backups", "/srv/nakama")
    ).not.toThrow();
  });

  test("a restart writes at once only when no recent backup exists", async () => {
    let exports = 0;

    const exportZip = async () => {
      exports += 1;

      return Buffer.from("zip");
    };

    const recent = await tempDir();
    await writeFile(join(recent, "nakama-2026-10-26T000000Z.zip.enc"), "x");

    const stopRecent = await startScheduledBackups({
      dir: recent,
      exportZip,
      key,
    });

    const empty = await tempDir();

    const stopEmpty = await startScheduledBackups({
      dir: empty,
      exportZip,
      key,
    });

    await Bun.sleep(50);
    stopRecent();
    stopEmpty();

    expect(exports).toBe(1);
    expect(await readdir(recent)).toHaveLength(1);
    expect(await readdir(empty)).toHaveLength(1);
  });
});
