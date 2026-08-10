import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "./index";

describe("database reopen after restore", () => {
  let rootDir = "";

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { force: true, recursive: true });
      rootDir = "";
    }
  });

  test("reopen reads the replacement sqlite file at the same path", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "nakama-db-reopen-"));
    const databaseUrl = `file:${join(rootDir, "sqlite", "nakama.sqlite")}`;
    const now = new Date().toISOString();

    const database = await createDatabase(databaseUrl);
    await database.adapter.createUser({
      createdAt: now,
      email: "admin@example.com",
      id: "user-1",
      isPlatformAdmin: true,
      name: "Admin",
      passwordHash: "hash",
      phone: null,
      updatedAt: now,
    });
    expect(await database.adapter.countHumanUsers()).toBe(1);

    const liveSqliteDir = join(rootDir, "sqlite");
    const backupSqliteDir = join(rootDir, "sqlite-backup");
    const stagedSqliteDir = join(rootDir, "sqlite-staged");
    await mkdir(stagedSqliteDir, { recursive: true });

    const staged = await createDatabase(
      `file:${join(stagedSqliteDir, "nakama.sqlite")}`
    );
    await staged.adapter.createUser({
      createdAt: now,
      email: "restored@example.com",
      id: "user-2",
      isPlatformAdmin: true,
      name: "Restored",
      passwordHash: "hash",
      phone: null,
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
    expect(
      await database.adapter.getUserByEmail("restored@example.com")
    ).not.toBeNull();
    expect(
      await database.adapter.getUserByEmail("admin@example.com")
    ).toBeNull();

    database.close();
  });
});
