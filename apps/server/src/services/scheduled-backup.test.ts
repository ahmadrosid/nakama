import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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

  test("refuses aliases into the data root, including missing child folders", async () => {
    const dir = await tempDir();
    const root = join(dir, "data");
    const nested = join(root, "backups");
    const alias = join(dir, "backup-alias");
    const rootAlias = join(dir, "data-alias");
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await mkdir(nested, { recursive: true });
    await symlink(nested, alias, linkType);
    await symlink(root, rootAlias, linkType);

    for (const target of [
      root,
      alias,
      join(alias, "new", "daily"),
      join(root, "..backups"),
    ]) {
      expect(() => assertBackupDirOutsideRoot(target, root)).toThrow();
      expect(() => assertBackupDirOutsideRoot(target, rootAlias)).toThrow();
    }

    expect(() => assertBackupDirOutsideRoot(rootAlias, root)).toThrow();
    expect(await readdir(nested)).toEqual([]);
  });

  test("allows external folders through aliases and creates missing backup folders", async () => {
    const dir = await tempDir();
    const root = join(dir, "data");
    const external = join(dir, "data-backups");
    const alias = join(dir, "external-alias");
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await mkdir(root);
    await mkdir(external);
    await symlink(external, alias, linkType);
    const missing = join(alias, "new", "daily");

    for (const target of [
      external,
      alias,
      missing,
      join(dir, "new", "backups"),
    ]) {
      expect(() => assertBackupDirOutsideRoot(target, root)).not.toThrow();
    }

    expect(() =>
      assertBackupDirOutsideRoot(external, join(root, "new"))
    ).not.toThrow();

    let exports = 0;

    const stop = await startScheduledBackups({
      dir: missing,
      exportZip: async () => {
        exports += 1;

        return Buffer.from("zip");
      },
      key,
    });

    try {
      await Bun.sleep(50);
      expect(exports).toBe(1);
      expect(await realpath(missing)).toBe(
        await realpath(join(external, "new", "daily"))
      );
      expect(await readdir(missing)).toHaveLength(1);
      expect(await readdir(root)).toEqual([]);
    } finally {
      stop();
    }
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
