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

  test("database operations wait for a short lock held by another process", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "nakama-db-lock-"));
    const path = join(rootDir, "nakama.sqlite");
    const database = await createDatabase(`file:${path}`);
    const now = new Date().toISOString();
    const operations = [
      async () => {
        const connection = await createDatabase(`file:${path}`);
        connection.close();
      },
      async () => expect(await database.adapter.countHumanUsers()).toBe(0),
      async () => {
        await database.adapter.createUser({
          createdAt: now,
          email: "locked@example.com",
          id: "locked-user",
          passwordHash: "hash",
          updatedAt: now,
        });
        expect(
          await database.adapter.getUserByEmail("locked@example.com")
        ).not.toBeNull();
      },
      async () => {
        await database.reopen();
        expect(await database.adapter.countHumanUsers()).toBe(1);
      },
    ];
    try {
      for (const operation of operations) {
        // A separate process must release the lock: SQLite blocks this thread.
        const locker = Bun.spawn(
          [
            process.execPath,
            "-e",
            `
          import { Database } from "bun:sqlite";
          const db = new Database(process.argv[1]);
          db.exec("BEGIN EXCLUSIVE");
          console.log("locked");
          setTimeout(() => { db.exec("COMMIT"); db.close(); }, 250);
        `,
            path,
          ],
          { stderr: "inherit", stdout: "pipe" }
        );
        try {
          const reader = locker.stdout.getReader();
          expect((await reader.read()).done).toBe(false);
          reader.releaseLock();
          await operation();
          expect(await locker.exited).toBe(0);
        } finally {
          locker.kill();
          await locker.exited;
        }
      }
    } finally {
      database.close();
    }
  }, 30_000);

  // 632ms locally, but it runs migrations twice against a real sqlite file and
  // has gone past bun's 5s default on a runner building nine workspaces at once.
  // The ENOENT that follows such a timeout is afterEach removing the temp dir
  // underneath the timed-out body, not a second fault.
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

    // A live restore releases its connection before moving the files.
    expect(await database.adapter.countHumanUsers()).toBe(1);
    database.release();

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
  }, 30_000);

  test("release frees the sqlite file so its directory can move, then reopen recovers", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "nakama-db-release-"));
    const database = await createDatabase(
      `file:${join(rootDir, "sqlite", "nakama.sqlite")}`
    );
    expect(await database.adapter.countHumanUsers()).toBe(0);

    database.release();

    // close() would leave the prepared statements, and the file, alive.
    await expect(database.adapter.countHumanUsers()).rejects.toThrow();
    await rename(join(rootDir, "sqlite"), join(rootDir, "sqlite-moved"));
    await rename(join(rootDir, "sqlite-moved"), join(rootDir, "sqlite"));

    await database.reopen();
    expect(await database.adapter.countHumanUsers()).toBe(0);
    database.release();
  }, 30_000);
});
