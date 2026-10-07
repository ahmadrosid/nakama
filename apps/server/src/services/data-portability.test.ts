import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NakamaApiError } from "@nakama/core";
import { createDatabase } from "@nakama/db";
import * as fflate from "fflate";
import {
  createNakamaDataExport,
  createNakamaOrgDataExport,
  decodeArchiveRequestData,
  MAX_IMPORT_ARCHIVE_BYTES,
  MAX_IMPORT_ENTRIES,
  MAX_IMPORT_ENTRY_BYTES,
  MAX_IMPORT_UNCOMPRESSED_BYTES,
  NAKAMA_EXPORT_MANIFEST,
  previewNakamaDataImport,
  restoreNakamaDataImport,
  retireAppUserData,
} from "./data-portability";
import { MeetingStore } from "./google-meet/store";

let rootDir = "";

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "nakama-data-portability-test-"));
});

// The entry-budget test creates 10,000 files; Windows deletion needs its own budget.
afterEach(async () => {
  if (rootDir) {
    await rm(rootDir, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
    rootDir = "";
  }
}, 30_000);

describe("Nakama data portability", () => {
  test("retirement preserves private bytes outside workspaces and normal exports, including orphan folders", async () => {
    const databasePath = join(rootDir, "sqlite", "nakama.sqlite");
    const database = await createDatabase(`file:${databasePath}`);
    const raw = new Database(databasePath);
    const oldConfigDir = process.env.NAKAMA_CONFIG_DIR;
    process.env.NAKAMA_CONFIG_DIR = rootDir;
    try {
      raw.exec(
        "INSERT INTO organizations (id,name,slug,created_at,updated_at) VALUES ('o','Org','o','now','now')"
      );
      raw.exec(
        "INSERT INTO profiles (id,name,org_id,created_at,updated_at) VALUES ('p','Profile','o','now','now')"
      );
      raw.exec(
        "INSERT INTO sessions (id,profile_id,channel,app_user_id,created_at,updated_at) VALUES ('old','p','web','alice','now','now')"
      );
      raw.exec(
        "INSERT INTO attachments (id,org_id,profile_id,session_id,channel,kind,media_type,size_bytes,storage_path,created_at) VALUES ('attachment','o','p','old','web','image','image/png',7,'unused','now')"
      );
      raw.exec(
        "CREATE TABLE api_keys (secret_hash TEXT); INSERT INTO api_keys VALUES ('old-key')"
      );
      const profile = join(rootDir, "orgs", "o", "profiles", "p");
      const history = join(rootDir, "orgs", "o", "session-history");
      await mkdir(join(profile, "users", "orphan", "artifacts"), {
        recursive: true,
      });
      await mkdir(join(profile, "attachments"), { recursive: true });
      await mkdir(history, { recursive: true });
      await writeFile(join(profile, "MEMORY.md"), "shared memory");
      await writeFile(
        join(profile, "users", "orphan", "artifacts", "secret.txt"),
        "private artifact"
      );
      await writeFile(
        join(profile, "attachments", "attachment"),
        "private attachment"
      );
      await writeFile(join(history, "old.jsonl"), "private history");
      const legacyBackup = await createNakamaDataExport({
        databasePath,
        rootDir,
      });
      await retireAppUserData(rootDir, databasePath);
      await retireAppUserData(rootDir, databasePath);
      const retired = join(rootDir, "retired-app-users", "o", "p");
      expect(
        await readFile(
          join(retired, "users", "orphan", "artifacts", "secret.txt"),
          "utf8"
        )
      ).toBe("private artifact");
      expect(
        await readFile(join(retired, "attachments", "attachment"), "utf8")
      ).toBe("private attachment");
      expect(
        await readFile(join(retired, "session-history", "old.jsonl"), "utf8")
      ).toBe("private history");
      expect(
        await Bun.file(
          join(profile, "users", "orphan", "artifacts", "secret.txt")
        ).exists()
      ).toBe(false);
      expect(await readFile(join(profile, "MEMORY.md"), "utf8")).toBe(
        "shared memory"
      );
      if (process.platform !== "win32") {
        expect((await lstat(retired)).mode % 0o1000).toBe(0o700);
        expect(
          (await lstat(join(retired, "attachments", "attachment"))).mode %
            0o1000
        ).toBe(0o600);
      }
      expect(
        raw.query("SELECT name FROM sqlite_master WHERE name='api_keys'").get()
      ).toBeNull();
      const normal = fflate.unzipSync(
        (await createNakamaOrgDataExport(database.adapter, "o")).data
      );
      expect(JSON.stringify(Object.keys(normal))).not.toContain(
        "retired-app-users"
      );
      expect(
        Buffer.concat(
          Object.values(normal).map((value) => Buffer.from(value))
        ).toString()
      ).not.toContain("private artifact");
      const backup = await createNakamaDataExport({ databasePath, rootDir });
      expect(
        fflate.unzipSync(backup.data)[
          "retired-app-users/o/p/attachments/attachment"
        ]
      ).toEqual(new Uint8Array(Buffer.from("private attachment")));
      database.release();
      raw.close(true);
      await restoreNakamaDataImport(legacyBackup.data, {
        confirm: true,
        databasePath,
        rootDir,
      });
      expect(
        await readFile(join(retired, "attachments", "attachment"), "utf8")
      ).toBe("private attachment");
      const restored = new Database(databasePath, { readonly: true });
      try {
        expect(
          restored
            .query("SELECT name FROM sqlite_master WHERE name='api_keys'")
            .get()
        ).toBeNull();
        expect(
          restored
            .query("SELECT app_user_id FROM sessions WHERE id='old'")
            .get()
        ).toEqual({ app_user_id: "alice" });
      } finally {
        restored.close(true);
      }
    } finally {
      raw.close(true);
      database.release();
      if (oldConfigDir === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = oldConfigDir;
      }
    }
  });

  test("retirement resumes an interrupted move and refuses conflicting files or symlinks", async () => {
    const source = join(
      rootDir,
      "orgs",
      "o",
      "profiles",
      "p",
      "users",
      "alice"
    );
    const target = join(
      rootDir,
      "retired-app-users",
      "o",
      "p",
      "users",
      "alice"
    );
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(join(source, "MEMORY.md"), "secret");
    await link(join(source, "MEMORY.md"), join(target, "MEMORY.md"));
    await retireAppUserData(rootDir, null);
    expect(await Bun.file(join(source, "MEMORY.md")).exists()).toBe(false);
    expect(await readFile(join(target, "MEMORY.md"), "utf8")).toBe("secret");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "MEMORY.md"), "new secret");
    await expect(retireAppUserData(rootDir, null)).rejects.toThrow();
    expect(await readFile(join(source, "MEMORY.md"), "utf8")).toBe(
      "new secret"
    );
    expect(await readFile(join(target, "MEMORY.md"), "utf8")).toBe("secret");
    await rm(join(source, "MEMORY.md"));
    await symlink(join(target, "MEMORY.md"), join(source, "escape.md"));
    await expect(retireAppUserData(rootDir, null)).rejects.toThrow();
    expect(await readFile(join(target, "MEMORY.md"), "utf8")).toBe("secret");
  });

  test("legacy restore sanitation failure leaves live data and runtime untouched", async () => {
    await writeFile(join(rootDir, "config.ini"), "live");
    const archive = fflate.zipSync({
      ...fflate.unzipSync(
        (await createNakamaDataExport({ databasePath: null, rootDir })).data
      ),
      "orgs/o/profiles/p/users/alice/MEMORY.md": Buffer.from("private"),
      "retired-app-users/o/p/users/alice/MEMORY.md": Buffer.from("conflict"),
    });
    let stopped = false;
    await expect(
      restoreNakamaDataImport(archive, {
        beforeReplace: () => {
          stopped = true;
        },
        confirm: true,
        databasePath: null,
        rootDir,
      })
    ).rejects.toThrow();
    expect(stopped).toBe(false);
    expect(await readFile(join(rootDir, "config.ini"), "utf8")).toBe("live");
  });

  test("built-in Meet snapshots round-trip saved transcripts while excluding temporary audio", async () => {
    const directory = join(rootDir, "orgs", "a", "meet");
    const store = new MeetingStore(directory, "a");
    const meeting = store.importFile("notes.md", "Saved meeting", "alice");
    store.close();
    await mkdir(join(directory, "audio"), { recursive: true });
    await writeFile(join(directory, "audio", "temporary.wav"), "audio");
    const exported = await createNakamaDataExport({
      databasePath: null,
      rootDir,
    });
    const files = Object.keys(fflate.unzipSync(exported.data));
    expect(files).toContain("orgs/a/meet/meetings.sqlite");
    expect(files.some((path) => path.includes("audio/"))).toBe(false);
    await restoreNakamaDataImport(exported.data, { confirm: true, rootDir });
    const restored = new MeetingStore(directory, "a");
    try {
      expect(
        restored
          .transcript(meeting.id, 0)
          .map((segment) => segment.text)
          .join("")
      ).toBe("Saved meeting");
    } finally {
      restored.close(true);
    }
  });
  test("round-trips a backup at the restore entry-byte limit", async () => {
    const filePath = join(rootDir, "at-budget.bin");
    await writeFile(filePath, Buffer.alloc(MAX_IMPORT_ENTRY_BYTES));
    const exported = await createNakamaDataExport({
      databasePath: null,
      rootDir,
    });
    const preview = await previewNakamaDataImport(exported.data, { rootDir });
    expect(preview.archiveFileCount).toBe(1);
    expect(preview.archiveTotalBytes).toBe(MAX_IMPORT_ENTRY_BYTES);

    const restored = await restoreNakamaDataImport(exported.data, {
      confirm: true,
      rootDir,
    });
    expect(restored.restoredFileCount).toBe(1);
    expect((await lstat(filePath)).size).toBe(MAX_IMPORT_ENTRY_BYTES);
  }, 30_000);

  test("rejects an export whose SQLite snapshot exceeds the restore entry budget", async () => {
    const databasePath = join(rootDir, "nakama.sqlite");
    const db = new Database(databasePath);
    try {
      db.exec("CREATE TABLE retained_data (payload BLOB)");
      db.run("INSERT INTO retained_data VALUES (zeroblob(?))", [
        MAX_IMPORT_ENTRY_BYTES + 1,
      ]);
    } finally {
      db.close();
    }

    await expect(
      createNakamaDataExport({ databasePath, rootDir })
    ).rejects.toMatchObject({ status: 413 });
    expect(await readdir(rootDir)).toEqual(["nakama.sqlite"]);
    const original = new Database(databasePath, { readonly: true });
    try {
      expect(
        original
          .query("SELECT length(payload) AS size FROM retained_data")
          .get()
      ).toEqual({
        size: MAX_IMPORT_ENTRY_BYTES + 1,
      });
    } finally {
      original.close();
    }
  }, 30_000);

  test("counts the manifest against the export entry budget", async () => {
    for (let start = 0; start < MAX_IMPORT_ENTRIES; start += 100) {
      await Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          writeFile(join(rootDir, `empty-${start + index}.txt`), "")
        )
      );
    }

    await expect(
      createNakamaDataExport({ databasePath: null, rootDir })
    ).rejects.toMatchObject({ status: 413 });
    expect((await readdir(rootDir)).length).toBe(MAX_IMPORT_ENTRIES);
  }, 30_000);

  test("counts the manifest against the export expanded-byte budget", async () => {
    for (let index = 0; index < 5; index += 1) {
      await writeFile(join(rootDir, `part-${index}.bin`), "original");
    }
    const readMock = spyOn(fsPromises, "readFile").mockResolvedValue(
      Buffer.alloc(MAX_IMPORT_ENTRY_BYTES)
    );
    try {
      await expect(
        createNakamaDataExport({ databasePath: null, rootDir })
      ).rejects.toMatchObject({ status: 413 });
    } finally {
      readMock.mockRestore();
    }
    expect((await readdir(rootDir)).length).toBe(5);
  });

  test("rejects a ZIP result above the compressed restore budget", async () => {
    await writeFile(join(rootDir, "config.ini"), "original");
    const zipMock = spyOn(fflate, "zipSync").mockReturnValue(
      new Uint8Array(MAX_IMPORT_ARCHIVE_BYTES + 1)
    );
    try {
      await expect(
        createNakamaDataExport({ databasePath: null, rootDir })
      ).rejects.toMatchObject({ status: 413 });
    } finally {
      zipMock.mockRestore();
    }
    expect(await readFile(join(rootDir, "config.ini"), "utf8")).toBe(
      "original"
    );
  });

  test("exports plugin worker data but omits redownloadable runtime caches", async () => {
    const worker = join(rootDir, "orgs/org-1/plugins/memory/workers/server");
    await mkdir(join(worker, "cache"), { recursive: true });
    await mkdir(join(worker, "data"), { recursive: true });
    await writeFile(join(worker, "cache/server"), "binary");
    await writeFile(join(worker, "data/memory.db"), "memories");
    const result = await createNakamaDataExport({ rootDir });
    expect(
      result.manifest.skipped.some((entry) => entry.path.includes("cache"))
    ).toBe(true);
    await restoreNakamaDataImport(result.data, { confirm: true, rootDir });
    expect(await readFile(join(worker, "data/memory.db"), "utf8")).toBe(
      "memories"
    );
    expect(await Bun.file(join(worker, "cache/server")).exists()).toBe(false);
  });

  test("exports config root content with a manifest", async () => {
    await writeFile(join(rootDir, "config.ini"), "provider=openai");
    await writeFile(join(rootDir, "nakama.db"), "sqlite");
    await writeFile(join(rootDir, "tools.js"), "module.exports = {}");

    const result = await createNakamaDataExport({
      now: new Date("2026-07-01T10:00:00.000Z"),
      rootDir,
    });
    const preview = await previewNakamaDataImport(result.data, { rootDir });

    expect(result.filename).toBe("nakama-export-2026-07-01T10-00-00-000Z.zip");
    expect(result.manifest.kind).toBe("nakama-export");
    expect(result.manifest.topLevelPaths).toEqual([
      "config.ini",
      "nakama.db",
      "tools.js",
    ]);
    expect(preview.manifest.createdAt).toBe("2026-07-01T10:00:00.000Z");
    expect(preview.archiveFileCount).toBe(3);
    expect(preview.topLevelPaths).toEqual([
      "config.ini",
      "nakama.db",
      "tools.js",
    ]);
  });

  test("reports external database paths without copying them", async () => {
    const outsideDb = join(
      await mkdtemp(join(tmpdir(), "nakama-external-db-")),
      "nakama.db"
    );
    await writeFile(join(rootDir, "config.ini"), "ok");

    try {
      const result = await createNakamaDataExport({
        databasePath: outsideDb,
        rootDir,
      });
      expect(result.manifest.skipped).toEqual([
        {
          path: outsideDb,
          reason: "Database path is outside the Nakama root.",
        },
      ]);
    } finally {
      await rm(join(outsideDb, ".."), { force: true, recursive: true });
    }
  });

  test("preview does not mutate existing data and restore replaces it after confirmation", async () => {
    await writeFile(join(rootDir, "config.ini"), "original");
    const exportResult = await createNakamaDataExport({ rootDir });

    await writeFile(join(rootDir, "config.ini"), "changed");
    await writeFile(join(rootDir, "extra.txt"), "remove me");

    const preview = await previewNakamaDataImport(exportResult.data, {
      rootDir,
    });
    expect(preview.willReplaceRoot).toBe(true);
    expect(await readFile(join(rootDir, "config.ini"), "utf8")).toBe("changed");

    const restore = await restoreNakamaDataImport(exportResult.data, {
      confirm: true,
      rootDir,
    });

    expect(restore.restoredFileCount).toBe(1);
    expect(await readFile(join(rootDir, "config.ini"), "utf8")).toBe(
      "original"
    );
    await expect(
      readFile(join(rootDir, "extra.txt"), "utf8")
    ).rejects.toThrow();
    await expect(
      readFile(join(rootDir, NAKAMA_EXPORT_MANIFEST), "utf8")
    ).rejects.toThrow();
  });

  test("restore keeps the root directory inode so volume mounts stay put", async () => {
    await writeFile(join(rootDir, "config.ini"), "original");
    const exportResult = await createNakamaDataExport({ rootDir });
    await writeFile(join(rootDir, "config.ini"), "changed");
    const before = await lstat(rootDir);

    await restoreNakamaDataImport(exportResult.data, {
      confirm: true,
      rootDir,
    });

    const after = await lstat(rootDir);
    expect(after.dev).toBe(before.dev);
    expect(after.ino).toBe(before.ino);
    expect(await readFile(join(rootDir, "config.ini"), "utf8")).toBe(
      "original"
    );

    const leftovers = (await readdir(rootDir)).filter(
      (name) =>
        name.startsWith(".nakama-backup-") ||
        name.startsWith(".nakama-restore-")
    );
    expect(leftovers).toEqual([]);
  });

  test("restore closes the live database before moving the data root", async () => {
    // Windows cannot rename or delete an open SQLite file, so the server's
    // handle must be released before live entries move to the backup.
    const databasePath = join(rootDir, "sqlite", "nakama.sqlite");
    const database = await createDatabase(`file:${databasePath}`);
    try {
      await writeFile(join(rootDir, "config.ini"), "original");
      const exportResult = await createNakamaDataExport({
        databasePath,
        rootDir,
      });
      await writeFile(join(rootDir, "config.ini"), "changed");

      let liveConfigWhenClosed: string | null = null;
      await restoreNakamaDataImport(exportResult.data, {
        beforeReplace: async () => {
          liveConfigWhenClosed = await readFile(
            join(rootDir, "config.ini"),
            "utf8"
          );
          database.release();
        },
        confirm: true,
        rootDir,
      });

      expect(liveConfigWhenClosed).toBe("changed");
      expect(await readFile(join(rootDir, "config.ini"), "utf8")).toBe(
        "original"
      );
      await database.reopen();
      expect(await database.adapter.countHumanUsers()).toBe(0);
    } finally {
      database.release();
    }
  });

  test("restore reopens the live database when it fails after closing it", async () => {
    await writeFile(join(rootDir, "config.ini"), "original");
    const exportResult = await createNakamaDataExport({ rootDir });
    await writeFile(join(rootDir, "config.ini"), "changed");

    const calls: string[] = [];
    await expect(
      restoreNakamaDataImport(exportResult.data, {
        afterFailedReplace: async () => {
          calls.push("reopen");
        },
        beforeReplace: async () => {
          calls.push("close");
          throw new Error("close failed");
        },
        confirm: true,
        rootDir,
      })
    ).rejects.toThrow("close failed");

    expect(calls).toEqual(["close", "reopen"]);
    expect(await readFile(join(rootDir, "config.ini"), "utf8")).toBe("changed");
  });

  test("restore keeps a live pm2 home inside the root in place", async () => {
    // The desktop app sets PM2_HOME inside its data root. Moving it away loses
    // pm2.pid, so quitting the app no longer stops the daemon and its workers.
    const sourceRoot = await mkdtemp(join(tmpdir(), "nakama-pm2-source-"));
    try {
      await mkdir(join(sourceRoot, "pm2"), { recursive: true });
      await writeFile(join(sourceRoot, "pm2", "pm2.pid"), "from-archive");
      await writeFile(join(sourceRoot, "config.ini"), "restored");
      const exportResult = await createNakamaDataExport({
        databasePath: null,
        rootDir: sourceRoot,
      });

      await mkdir(join(rootDir, "pm2"), { recursive: true });
      await writeFile(join(rootDir, "pm2", "pm2.pid"), "live");
      await writeFile(join(rootDir, "config.ini"), "live");
      await restoreNakamaDataImport(exportResult.data, {
        confirm: true,
        databasePath: null,
        pm2Home: join(rootDir, "pm2"),
        rootDir,
      });

      expect(await readFile(join(rootDir, "pm2", "pm2.pid"), "utf8")).toBe(
        "live"
      );
      expect(await readFile(join(rootDir, "config.ini"), "utf8")).toBe(
        "restored"
      );
    } finally {
      await rm(sourceRoot, { force: true, recursive: true });
    }
  });

  test("restore keeps the log file this process writes to", async () => {
    await writeFile(join(rootDir, "config.ini"), "original");
    const exportResult = await createNakamaDataExport({
      databasePath: null,
      rootDir,
    });
    await writeFile(join(rootDir, "server.log"), "live session");

    await restoreNakamaDataImport(exportResult.data, {
      confirm: true,
      databasePath: null,
      pm2Home: null,
      rootDir,
      serverLog: join(rootDir, "server.log"),
    });

    expect(await readFile(join(rootDir, "server.log"), "utf8")).toBe(
      "live session"
    );
  });

  test("restore still replaces a shared directory that holds the pm2 home", async () => {
    // PM2_HOME under data/ must not freeze data/sqlite/nakama.sqlite in place.
    await mkdir(join(rootDir, "data"), { recursive: true });
    await writeFile(join(rootDir, "data", "notes.txt"), "original");
    const exportResult = await createNakamaDataExport({
      databasePath: null,
      rootDir,
    });
    await writeFile(join(rootDir, "data", "notes.txt"), "changed");

    await restoreNakamaDataImport(exportResult.data, {
      confirm: true,
      databasePath: null,
      pm2Home: join(rootDir, "data", "pm2"),
      rootDir,
    });

    expect(await readFile(join(rootDir, "data", "notes.txt"), "utf8")).toBe(
      "original"
    );
  });

  test("restore replaces a pm2 directory that is not the live pm2 home", async () => {
    // Installs whose PM2_HOME is outside the root restore exactly as before.
    await writeFile(join(rootDir, "config.ini"), "original");
    const exportResult = await createNakamaDataExport({
      databasePath: null,
      rootDir,
    });
    await mkdir(join(rootDir, "pm2"), { recursive: true });
    await writeFile(join(rootDir, "pm2", "pm2.pid"), "stale");

    await restoreNakamaDataImport(exportResult.data, {
      confirm: true,
      databasePath: null,
      pm2Home: join(tmpdir(), "elsewhere", ".pm2"),
      rootDir,
    });

    expect(await Bun.file(join(rootDir, "pm2", "pm2.pid")).exists()).toBe(
      false
    );
  });

  test("restore moves a server-layout database to where a desktop root reads it", async () => {
    // The server defaults to data/sqlite/nakama.sqlite; the desktop app reads sqlite/nakama.sqlite.
    const sourceRoot = await mkdtemp(join(tmpdir(), "nakama-web-root-"));
    try {
      const sourceDatabase = join(
        sourceRoot,
        "data",
        "sqlite",
        "nakama.sqlite"
      );
      await mkdir(join(sourceRoot, "data", "sqlite"), { recursive: true });
      const schema = await createDatabase(`file:${sourceDatabase}`);
      schema.release();
      const source = new Database(sourceDatabase);
      source.exec(
        "INSERT INTO organizations (id,name,slug,created_at,updated_at) VALUES ('org-1','Org','org-1','now','now')"
      );
      source.exec(
        "INSERT INTO org_plugins (org_id,plugin_id,lifecycle_state,revision,pending_operation,created_at,updated_at) VALUES ('org-1', 'notes', 'enabled', 1, NULL, 'now', '2026-09-30T00:00:00.000Z')"
      );
      source.close(true);
      const exportResult = await createNakamaDataExport({
        databasePath: sourceDatabase,
        rootDir: sourceRoot,
      });

      const liveDatabase = join(rootDir, "sqlite", "nakama.sqlite");
      await restoreNakamaDataImport(exportResult.data, {
        confirm: true,
        databasePath: liveDatabase,
        rootDir,
      });

      expect(
        await Bun.file(
          join(rootDir, "data", "sqlite", "nakama.sqlite")
        ).exists()
      ).toBe(false);
      const restored = new Database(liveDatabase, { readonly: true });
      try {
        expect(
          restored.query("SELECT lifecycle_state FROM org_plugins").get()
        ).toEqual({ lifecycle_state: "disabled" });
      } finally {
        restored.close(true);
      }
    } finally {
      await rm(sourceRoot, { force: true, recursive: true });
    }
  });

  test("restore moves a desktop-layout database to where a server root reads it", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "nakama-desktop-root-"));
    try {
      const sourceDatabase = join(sourceRoot, "sqlite", "nakama.sqlite");
      await mkdir(join(sourceRoot, "sqlite"), { recursive: true });
      const source = new Database(sourceDatabase, { create: true });
      source.exec("CREATE TABLE marker (value TEXT)");
      source.exec("INSERT INTO marker VALUES ('desktop')");
      source.close(true);
      const exportResult = await createNakamaDataExport({
        databasePath: sourceDatabase,
        rootDir: sourceRoot,
      });

      const liveDatabase = join(rootDir, "data", "sqlite", "nakama.sqlite");
      await restoreNakamaDataImport(exportResult.data, {
        confirm: true,
        databasePath: liveDatabase,
        rootDir,
      });

      expect(
        await Bun.file(join(rootDir, "sqlite", "nakama.sqlite")).exists()
      ).toBe(false);
      const restored = new Database(liveDatabase, { readonly: true });
      try {
        expect(restored.query("SELECT value FROM marker").get()).toEqual({
          value: "desktop",
        });
      } finally {
        restored.close(true);
      }
    } finally {
      await rm(sourceRoot, { force: true, recursive: true });
    }
  });

  test("restore disables plugins in the configured live database", async () => {
    // The restore routes pass no databasePath, so the desktop app's
    // sqlite/nakama.sqlite comes only from DATABASE_URL.
    const sourceRoot = await mkdtemp(join(tmpdir(), "nakama-desktop-source-"));
    const previousDatabaseUrl = process.env.DATABASE_URL;
    try {
      const sourceDatabase = join(sourceRoot, "sqlite", "nakama.sqlite");
      await mkdir(join(sourceRoot, "sqlite"), { recursive: true });
      const schema = await createDatabase(`file:${sourceDatabase}`);
      schema.release();
      const source = new Database(sourceDatabase);
      source.exec(
        "INSERT INTO organizations (id,name,slug,created_at,updated_at) VALUES ('org-1','Org','org-1','now','now')"
      );
      source.exec(
        "INSERT INTO org_plugins (org_id,plugin_id,lifecycle_state,revision,pending_operation,created_at,updated_at) VALUES ('org-1', 'notes', 'enabled', 1, NULL, 'now', '2026-09-30T00:00:00.000Z')"
      );
      source.close(true);
      const exportResult = await createNakamaDataExport({
        databasePath: sourceDatabase,
        rootDir: sourceRoot,
      });

      const liveDatabase = join(rootDir, "sqlite", "nakama.sqlite");
      process.env.DATABASE_URL = `file:${liveDatabase}`;
      await restoreNakamaDataImport(exportResult.data, {
        confirm: true,
        rootDir,
      });

      const restored = new Database(liveDatabase, { readonly: true });
      try {
        expect(
          restored.query("SELECT lifecycle_state FROM org_plugins").get()
        ).toEqual({ lifecycle_state: "disabled" });
      } finally {
        restored.close(true);
      }
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
      await rm(sourceRoot, { force: true, recursive: true });
    }
  });

  test("restore leaves the live database open when the archive is rejected", async () => {
    let closed = false;
    await expect(
      restoreNakamaDataImport(Buffer.from("not a zip"), {
        beforeReplace: () => {
          closed = true;
        },
        confirm: true,
        rootDir,
      })
    ).rejects.toThrow("Invalid ZIP archive.");
    expect(closed).toBe(false);
  });

  test("restore requires explicit confirmation", async () => {
    await writeFile(join(rootDir, "config.ini"), "original");
    const exportResult = await createNakamaDataExport({ rootDir });

    await expect(
      restoreNakamaDataImport(exportResult.data, { confirm: false, rootDir })
    ).rejects.toThrow("Restore confirmation is required.");
  });

  test("rejects malformed archives and unsafe entry paths", async () => {
    await expect(
      previewNakamaDataImport(Buffer.from("not a zip"), { rootDir })
    ).rejects.toThrow("Invalid ZIP archive.");

    const unsafe = buildUnsafeZip();
    await expect(previewNakamaDataImport(unsafe, { rootDir })).rejects.toThrow(
      "Archive entry escapes restore root"
    );

    const reserved = buildZipWithEntry(".nakama-backup-evil/secret.txt", "{}");
    await expect(
      previewNakamaDataImport(reserved, { rootDir })
    ).rejects.toThrow("Archive entry uses a reserved restore path");
  });

  test.each([
    "notes/10:30.md",
    "notes/summary.md::$DATA",
    "notes:stream/summary.md",
  ])(
    "Windows rejects colon archive entry %s before replacing data",
    async (name) => {
      await writeFile(join(rootDir, "config.ini"), "original");
      const archive = fflate.zipSync({
        [NAKAMA_EXPORT_MANIFEST]: Buffer.from(
          JSON.stringify({ kind: "nakama-export", version: 1 })
        ),
        "config.ini": Buffer.from("replacement"),
        [name]: Buffer.from("synthetic"),
      });
      let closed = false;
      const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
      // Exercise the Windows admission check locally; CI also runs on Windows.
      Object.defineProperty(process, "platform", { value: "win32" });
      try {
        await expect(
          previewNakamaDataImport(archive, { rootDir })
        ).rejects.toMatchObject({ status: 400 });
        await expect(
          restoreNakamaDataImport(archive, {
            beforeReplace: () => {
              closed = true;
            },
            confirm: true,
            databasePath: null,
            rootDir,
          })
        ).rejects.toMatchObject({ status: 400 });
      } finally {
        Object.defineProperty(process, "platform", platform);
      }
      expect(closed).toBe(false);
      expect(await readFile(join(rootDir, "config.ini"), "utf8")).toBe(
        "original"
      );
      expect(await readdir(rootDir)).toEqual(["config.ini"]);
    }
  );

  test("restores a normal nested archive entry on Windows", async () => {
    const archive = fflate.zipSync({
      [NAKAMA_EXPORT_MANIFEST]: Buffer.from(
        JSON.stringify({ kind: "nakama-export", version: 1 })
      ),
      "notes/summary.md": Buffer.from("retained"),
    });
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const preview = await previewNakamaDataImport(archive, { rootDir });
      expect(preview.archiveFileCount).toBe(1);
      const result = await restoreNakamaDataImport(archive, {
        confirm: true,
        databasePath: null,
        rootDir,
      });
      expect(result.restoredFileCount).toBe(1);
      expect(await readFile(join(rootDir, "notes/summary.md"), "utf8")).toBe(
        "retained"
      );
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  test.skipIf(process.platform === "win32")(
    "restores colon archive entries on POSIX",
    async () => {
      const entries = {
        "notes:stream/summary.md": "directory",
        "notes/10:30.md": "time",
        "notes/summary.md::$DATA": "stream",
      };
      const archive = fflate.zipSync({
        [NAKAMA_EXPORT_MANIFEST]: Buffer.from(
          JSON.stringify({ kind: "nakama-export", version: 1 })
        ),
        ...Object.fromEntries(
          Object.entries(entries).map(([name, content]) => [
            name,
            Buffer.from(content),
          ])
        ),
      });
      const preview = await previewNakamaDataImport(archive, { rootDir });
      expect(preview.archiveFileCount).toBe(3);
      const result = await restoreNakamaDataImport(archive, {
        confirm: true,
        databasePath: null,
        rootDir,
      });
      expect(result.restoredFileCount).toBe(3);
      for (const [name, content] of Object.entries(entries)) {
        expect(await readFile(join(rootDir, name), "utf8")).toBe(content);
      }
    }
  );

  test("partial backup failure does not delete unbacked siblings", async () => {
    await writeFile(join(rootDir, "keep.ini"), "keep-me");
    await writeFile(join(rootDir, "move.ini"), "move-me");
    const exportResult = await createNakamaDataExport({ rootDir });

    const fsPromises = await import("node:fs/promises");
    const originalRename = fsPromises.rename;
    const { spyOn } = await import("bun:test");
    const renameMock = spyOn(fsPromises, "rename").mockImplementation(
      async (from, to) => {
        const toPath = String(to);
        if (toPath.includes(".nakama-backup-") && toPath.endsWith("move.ini")) {
          throw Object.assign(new Error("simulated backup failure"), {
            code: "EIO",
          });
        }
        return originalRename(from, to);
      }
    );

    try {
      await expect(
        restoreNakamaDataImport(exportResult.data, { confirm: true, rootDir })
      ).rejects.toThrow("simulated backup failure");

      await expect(readFile(join(rootDir, "keep.ini"), "utf8")).resolves.toBe(
        "keep-me"
      );
      await expect(readFile(join(rootDir, "move.ini"), "utf8")).resolves.toBe(
        "move-me"
      );
    } finally {
      renameMock.mockRestore();
    }
  });

  test("rejects a base64 payload over the archive cap before decoding", () => {
    const oversized = "A".repeat(
      Math.ceil(MAX_IMPORT_ARCHIVE_BYTES / 3) * 4 + 1
    );

    let status = 0;
    try {
      decodeArchiveRequestData(oversized);
    } catch (error) {
      status = (error as NakamaApiError).status;
    }

    expect(status).toBe(413);
  });

  test("rejects an archive entry declaring more than the entry cap", async () => {
    const archive = buildZipWithEntries([
      {
        content: "{}",
        declaredSize: MAX_IMPORT_ENTRY_BYTES + 1,
        name: "big.bin",
      },
    ]);

    await expect(previewNakamaDataImport(archive, { rootDir })).rejects.toThrow(
      /big\.bin exceeds/
    );
  });

  test("rejects an archive with more entries than the entry-count cap", async () => {
    const archive = buildZipWithEntries(
      Array.from({ length: MAX_IMPORT_ENTRIES + 1 }, (_, index) => ({
        content: "",
        name: `empty-${index}.txt`,
      }))
    );

    await expect(previewNakamaDataImport(archive, { rootDir })).rejects.toThrow(
      /entry limit/
    );
  });

  test("rejects an archive whose entries add up past the total cap", async () => {
    const count =
      Math.ceil(MAX_IMPORT_UNCOMPRESSED_BYTES / MAX_IMPORT_ENTRY_BYTES) + 1;
    const archive = buildZipWithEntries(
      Array.from({ length: count }, (_, index) => ({
        content: "{}",
        declaredSize: MAX_IMPORT_ENTRY_BYTES,
        name: `part-${index}.bin`,
      }))
    );

    await expect(previewNakamaDataImport(archive, { rootDir })).rejects.toThrow(
      /uncompressed limit/
    );
  });
});

function buildZipWithEntry(name: string, content: string): Buffer {
  return buildZipWithEntries([{ content, name }]);
}

/**
 * Hand-rolled so an entry can declare an uncompressed size it does not have,
 * which is the shape the import size caps have to refuse.
 */
function buildZipWithEntries(
  entries: Array<{ content: string; declaredSize?: number; name: string }>
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const safe = Buffer.from(entry.content, "utf8");
    const declared = entry.declaredSize ?? safe.length;
    const nameBytes = Buffer.from(entry.name);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04_03_4b_50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x08_00, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(safe.length, 18);
    localHeader.writeUInt32LE(declared, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02_01_4b_50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x08_00, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(safe.length, 20);
    centralHeader.writeUInt32LE(declared, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt32LE(offset, 42);

    locals.push(localHeader, nameBytes, safe);
    centrals.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + safe.length;
  }

  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06_05_4b_50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, central, end]);
}

function buildUnsafeZip(): Buffer {
  return buildZipWithEntry("../escape.txt", "{}");
}
