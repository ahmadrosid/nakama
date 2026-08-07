import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "./index";

describe("database reopen after restore", () => {
  let rootDir = "";

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
      rootDir = "";
    }
  });

  // Runs migrations twice against a real sqlite file. That is under a second locally but
  // went past bun's 5s default on a CI runner building nine workspaces at once, and the
  // ENOENT that followed was afterEach cleaning up underneath the timed-out body.
  test("reopen reads the replacement sqlite file at the same path", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "nakama-db-reopen-"));
    const databaseUrl = `file:${join(rootDir, "sqlite", "nakama.sqlite")}`;
    const now = new Date().toISOString();

    const database = await createDatabase(databaseUrl);
    await database.adapter.createUser({
      id: "user-1",
      email: "admin@example.com",
      name: "Admin",
      phone: null,
      passwordHash: "hash",
      isPlatformAdmin: true,
      createdAt: now,
      updatedAt: now,
    });
    expect(await database.adapter.countHumanUsers()).toBe(1);

    const liveSqliteDir = join(rootDir, "sqlite");
    const backupSqliteDir = join(rootDir, "sqlite-backup");
    const stagedSqliteDir = join(rootDir, "sqlite-staged");
    await mkdir(stagedSqliteDir, { recursive: true });

    const staged = await createDatabase(`file:${join(stagedSqliteDir, "nakama.sqlite")}`);
    await staged.adapter.createUser({
      id: "user-2",
      email: "restored@example.com",
      name: "Restored",
      phone: null,
      passwordHash: "hash",
      isPlatformAdmin: true,
      createdAt: now,
      updatedAt: now,
    });
    await writeFile(join(stagedSqliteDir, "marker.txt"), "restored");
    staged.close();

    // Still holding the old connection — same situation as a live restore.
    expect(await database.adapter.countHumanUsers()).toBe(1);

    await rename(liveSqliteDir, backupSqliteDir);
    await rename(stagedSqliteDir, liveSqliteDir);
    await database.reopen();

    expect(await database.adapter.countHumanUsers()).toBe(1);
    expect(await database.adapter.getUserByEmail("restored@example.com")).not.toBeNull();
    expect(await database.adapter.getUserByEmail("admin@example.com")).toBeNull();

    database.close();
  }, 30_000);
});
