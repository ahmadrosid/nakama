import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NakamaApiError } from "@nakama/core";
import { decodeArchiveRequestData } from "./data-portability";
import {
  assertBackupDirOutsideRoot,
  type BackupExportFile,
  encryptBackup,
  readBackupError,
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

async function makeExportFile(contents: string) {
  const path = join(await tempDir(), "export.zip");
  await writeFile(path, contents);

  return { cleanup: async () => undefined, path };
}

// A scheduled run is async and slow on Windows CI, so wait for its result, not a fixed time
async function waitFor(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 5000;

  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the scheduled backup");
    }

    await Bun.sleep(10);
  }
}

async function hasBackup(dir: string) {
  return (await readdir(dir)).some((name) => name.endsWith(".zip.enc"));
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
        exportFile: () => makeExportFile(`day ${day}`),
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
      exportFile: async () => {
        exports += 1;

        return await makeExportFile("zip");
      },
      key,
    });

    try {
      await waitFor(() => hasBackup(missing));
      expect(exports).toBe(1);
      expect(await realpath(missing)).toBe(
        await realpath(join(external, "new", "daily"))
      );
      expect(await readdir(missing)).toHaveLength(1);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await stop();
    }
  });

  test("a restart writes at once only when no recent backup exists", async () => {
    let exports = 0;

    const exportFile = async () => {
      exports += 1;

      return await makeExportFile("zip");
    };

    const recent = await tempDir();
    await writeFile(join(recent, "nakama-2026-10-26T000000Z.zip.enc"), "x");

    const stopRecent = await startScheduledBackups({
      dir: recent,
      exportFile,
      key,
    });

    const empty = await tempDir();

    const stopEmpty = await startScheduledBackups({
      dir: empty,
      exportFile,
      key,
    });

    await waitFor(() => hasBackup(empty));
    await stopRecent();
    await stopEmpty();

    expect(exports).toBe(1);
    expect(await readdir(recent)).toHaveLength(1);
    expect(await readdir(empty)).toHaveLength(1);
  });

  test("keeps the last failed run for Settings until the next good backup", async () => {
    const dir = await tempDir();

    const blocked = new NakamaApiError(
      "Cannot export a restorable backup: the server cannot read config.ini.",
      409
    );

    const tooBig = new NakamaApiError(
      "Cannot export a restorable backup: ZIP exceeds the import limit.",
      413
    );

    await runOnce(dir, () => Promise.reject(blocked));
    expect(await readBackupError(dir)).toEqual({
      at: expect.any(String),
      message: blocked.message,
    });

    // A later failure of another kind replaces the old record
    await runOnce(dir, () => Promise.reject(tooBig));
    expect((await readBackupError(dir))?.message).toBe(tooBig.message);

    // A plain error is recorded too, without its raw detail
    await runOnce(dir, () => Promise.reject(new Error("EIO /secret/path")));
    const plain = await readBackupError(dir);
    expect(plain).not.toBeNull();
    expect(plain?.message).not.toContain("/secret/path");

    await runOnce(dir, () => makeExportFile("zip"));
    expect(await readBackupError(dir)).toBeNull();
    expect(await readdir(dir)).toHaveLength(1);
  });

  test("a written backup is not reported as failed when the old record cannot be cleared", async () => {
    const dir = await tempDir();
    // A folder with content where the error file goes: rm without recursive refuses it
    await mkdir(join(dir, "scheduled-backup-error.json", "x"), {
      recursive: true,
    });
    const errors = spyOn(console, "error").mockImplementation(() => {});

    try {
      await runOnce(dir, () => makeExportFile("zip"));

      // Only the failed cleanup is logged: no failed run, no record attempt
      expect(errors).toHaveBeenCalledTimes(1);
      expect(await readdir(dir)).toHaveLength(2);
    } finally {
      errors.mockRestore();
    }
  });

  test("a written backup is not reported as failed when old backups cannot be removed", async () => {
    const dir = await tempDir();
    const old = new Date("2000-01-01T00:00:00Z");

    // Seven old "backups" that are folders: unlink refuses them, so rotation fails
    for (let day = 1; day <= 7; day += 1) {
      const path = join(dir, `nakama-2000-01-0${day}T000000Z.zip.enc`);
      await mkdir(path);
      await utimes(path, old, old);
    }

    await writeFile(
      join(dir, "scheduled-backup-error.json"),
      JSON.stringify({ at: old.toISOString(), message: "old failure" })
    );
    const errors = spyOn(console, "error").mockImplementation(() => {});

    try {
      await runOnce(dir, () => makeExportFile("zip"));

      expect(await readBackupError(dir)).toBeNull();
      expect(errors).toHaveBeenCalledTimes(1);
      expect(await readdir(dir)).toHaveLength(8);
    } finally {
      errors.mockRestore();
    }
  });

  test("a failure it cannot write to disk still replaces the old record", async () => {
    const dir = await tempDir();
    const file = join(dir, "scheduled-backup-error.json");

    await writeFile(
      file,
      JSON.stringify({ at: new Date().toISOString(), message: "old failure" })
    );
    // A folder with content where the temp record goes: the record write fails
    await mkdir(join(`${file}.tmp`, "x"), { recursive: true });

    const blocked = new NakamaApiError("disk is full", 409);
    const errors = spyOn(console, "error").mockImplementation(() => {});

    try {
      await runOnce(dir, () => Promise.reject(blocked));
      expect((await readBackupError(dir))?.message).toBe(blocked.message);

      await runOnce(dir, () => makeExportFile("zip"));
      expect(await readBackupError(dir)).toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  test("stop waits for a run that already started and does not schedule another", async () => {
    const dir = await tempDir();
    let release = () => {};

    let exports = 0;

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    let started = () => {};

    const running = new Promise<void>((resolve) => {
      started = resolve;
    });

    const stop = await startScheduledBackups({
      dir,
      exportFile: async () => {
        exports += 1;
        started();
        await gate;

        return makeExportFile("zip");
      },
      key,
    });

    await running;
    const stopped = stop();
    release();
    await stopped;

    expect(exports).toBe(1);
    expect(await readdir(dir)).toHaveLength(1);
  });

  test("fails on an error record it cannot read instead of reporting no failure", async () => {
    const dir = await tempDir();
    const file = join(dir, "scheduled-backup-error.json");
    const errors = spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(await readBackupError(dir)).toBeNull();

      await writeFile(file, "not json");
      const invalid = await readBackupError(dir).catch((error) => error);
      expect(invalid).toEqual(expect.objectContaining({ status: 500 }));

      const unreadable = expect.objectContaining({
        message: invalid.message,
        status: 500,
      });

      await writeFile(file, JSON.stringify({ at: "yesterday", message: "x" }));
      await expect(readBackupError(dir)).rejects.toEqual(unreadable);

      // A read error (EISDIR) gets the same fixed line; its fs detail goes to the log only
      await rm(file);
      await mkdir(file);
      await expect(readBackupError(dir)).rejects.toEqual(unreadable);
      expect(errors).toHaveBeenCalledTimes(3);
    } finally {
      errors.mockRestore();
    }
  });

  test("a run that throws does not make stop reject", async () => {
    const dir = await tempDir();
    const errors = spyOn(console, "error").mockImplementation(() => {});

    try {
      // String() cannot convert this, so describe throws inside the catch
      await runOnce(dir, () => Promise.reject(Object.create(null)));
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});

/** Starts the scheduler on a dir with no backup, so it runs at once, and stops after that run. */
async function runOnce(
  dir: string,
  exportFile: () => Promise<BackupExportFile>
): Promise<void> {
  let started = () => {};

  const running = new Promise<void>((resolve) => {
    started = resolve;
  });

  const stop = await startScheduledBackups({
    dir,
    exportFile: () => {
      started();

      return exportFile();
    },
    key,
  });

  await running;
  await stop();
}
