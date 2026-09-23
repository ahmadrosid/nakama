import { Database as SQLiteDatabase } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "@nakama/db";
import { createNakamaDataExport } from "./services/data-portability";
import { acquireDataRootLock } from "./services/data-root-lock";

let workDir = "";

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { force: true, recursive: true });
    workDir = "";
  }
});

test("offline restore refuses a live root, then restores after the lock is released", async () => {
  workDir = await mkdtemp(join(tmpdir(), "nakama-offline-restore-"));
  const rootDir = join(workDir, "data");
  const archivePath = join(workDir, "backup.zip");
  const markerPath = join(rootDir, "marker.txt");
  const databasePath = join(rootDir, "sqlite", "nakama.sqlite");
  const release = acquireDataRootLock(rootDir);
  await writeFile(markerPath, "original");
  const database = await createDatabase(`file:${databasePath}`);
  const now = new Date().toISOString();
  await database.adapter.createUser({
    createdAt: now,
    email: "original@example.com",
    id: "original-user",
    name: "Original",
    passwordHash: "hash",
    updatedAt: now,
  });
  const records = new SQLiteDatabase(databasePath);
  records.run(
    "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('org-1', 'Org', 'org-1', ?, ?)",
    [now, now]
  );
  records.run(
    "INSERT INTO org_plugins (org_id, plugin_id, lifecycle_state, revision, created_at, updated_at) VALUES ('org-1', 'postgresql', 'enabled', 1, ?, ?)",
    [now, now]
  );
  records.close();
  const archive = await createNakamaDataExport({
    databasePath,
    rootDir,
  });
  expect(archive.manifest.fileCount).toBe(2);
  await writeFile(archivePath, archive.data);
  await writeFile(markerPath, "changed");
  await database.adapter.createUser({
    createdAt: now,
    email: "new@example.com",
    id: "new-user",
    name: "New",
    passwordHash: "hash",
    updatedAt: now,
  });

  const restore = () =>
    Bun.spawn({
      cmd: [process.execPath, "run", "restore:offline", "--yes", archivePath],
      cwd: join(import.meta.dir, "../../.."),
      env: {
        ...process.env,
        DATABASE_URL: `file:${databasePath}`,
        NAKAMA_CONFIG_DIR: rootDir,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

  try {
    const blocked = restore();
    expect(await blocked.exited).not.toBe(0);
    expect(await readFile(markerPath, "utf8")).toBe("changed");
  } finally {
    database.close();
    release();
  }

  const completed = restore();
  expect(await completed.exited).toBe(0);
  expect(await readFile(markerPath, "utf8")).toBe("original");
  const restored = await createDatabase(`file:${databasePath}`);
  try {
    expect(await restored.adapter.countHumanUsers()).toBe(1);
    expect(await restored.adapter.getUserByEmail("new@example.com")).toBeNull();
    expect(
      (await restored.adapter.getOrgPlugin("org-1", "postgresql"))
        ?.lifecycleState
    ).toBe("disabled");
  } finally {
    restored.close();
  }
  const reacquired = acquireDataRootLock(rootDir);
  reacquired();
}, 20_000);

test("offline restore leaves a ZIP inside the data root untouched", async () => {
  workDir = await mkdtemp(join(tmpdir(), "nakama-offline-restore-"));
  const rootDir = join(workDir, "data");
  const release = acquireDataRootLock(rootDir);
  await writeFile(join(rootDir, "marker.txt"), "original");
  const archive = await createNakamaDataExport({ databasePath: null, rootDir });
  release();
  const archivePath = join(rootDir, "backup.zip");
  await writeFile(archivePath, archive.data);
  await writeFile(join(rootDir, "marker.txt"), "changed");

  const child = Bun.spawn({
    cmd: [process.execPath, "run", "restore:offline", "--yes", archivePath],
    cwd: join(import.meta.dir, "../../.."),
    env: { ...process.env, NAKAMA_CONFIG_DIR: rootDir },
    stderr: "pipe",
    stdout: "pipe",
  });
  expect(await child.exited).not.toBe(0);
  expect(Array.from(await readFile(archivePath))).toEqual(
    Array.from(archive.data)
  );
  expect(await readFile(join(rootDir, "marker.txt"), "utf8")).toBe("changed");
});

test("offline restore rejects databases outside the backed-up data root", async () => {
  workDir = await mkdtemp(join(tmpdir(), "nakama-offline-restore-"));
  const rootDir = join(workDir, "data");
  const release = acquireDataRootLock(rootDir);
  const markerPath = join(rootDir, "marker.txt");
  await writeFile(markerPath, "original");
  const archive = await createNakamaDataExport({ databasePath: null, rootDir });
  release();
  const archivePath = join(workDir, "backup.zip");
  const outsideDatabase = join(workDir, "external.sqlite");
  await writeFile(archivePath, archive.data);
  await writeFile(outsideDatabase, "untouched");
  await writeFile(markerPath, "changed");

  const child = Bun.spawn({
    cmd: [process.execPath, "run", "restore:offline", "--yes", archivePath],
    cwd: join(import.meta.dir, "../../.."),
    env: {
      ...process.env,
      DATABASE_URL: `file:${outsideDatabase}`,
      NAKAMA_CONFIG_DIR: rootDir,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  expect(await child.exited).not.toBe(0);
  expect(await readFile(markerPath, "utf8")).toBe("changed");
  expect(await readFile(outsideDatabase, "utf8")).toBe("untouched");
});

test("offline restore accepts a data root reached through a directory link", async () => {
  workDir = await mkdtemp(join(tmpdir(), "nakama-offline-restore-"));
  const rootDir = join(workDir, "data");
  const release = acquireDataRootLock(rootDir);
  const markerPath = join(rootDir, "marker.txt");
  const databasePath = join(rootDir, "sqlite", "nakama.sqlite");
  const database = await createDatabase(`file:${databasePath}`);
  await writeFile(markerPath, "original");
  const archive = await createNakamaDataExport({ databasePath, rootDir });
  database.close();
  release();
  await writeFile(markerPath, "changed");
  const linkedRoot = join(workDir, "alias");
  await symlink(
    rootDir,
    linkedRoot,
    process.platform === "win32" ? "junction" : "dir"
  );
  const archivePath = join(workDir, "backup.zip");
  await writeFile(archivePath, archive.data);

  const child = Bun.spawn({
    cmd: [process.execPath, "run", "restore:offline", "--yes", archivePath],
    cwd: join(import.meta.dir, "../../.."),
    env: {
      ...process.env,
      DATABASE_URL: "file:sqlite/nakama.sqlite",
      NAKAMA_CONFIG_DIR: linkedRoot,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  expect(await child.exited).toBe(0);
  expect(await readFile(markerPath, "utf8")).toBe("original");
});
