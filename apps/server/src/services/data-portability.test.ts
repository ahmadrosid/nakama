import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NakamaApiError } from "@nakama/core";
import { createDatabase } from "@nakama/db";
import * as fflate from "fflate";
import {
  createNakamaDataExport,
  decodeArchiveRequestData,
  MAX_IMPORT_ARCHIVE_BYTES,
  MAX_IMPORT_ENTRIES,
  MAX_IMPORT_ENTRY_BYTES,
  MAX_IMPORT_UNCOMPRESSED_BYTES,
  NAKAMA_EXPORT_MANIFEST,
  previewNakamaDataImport,
  restoreNakamaDataImport,
} from "./data-portability";
import { MeetingStore } from "./google-meet/store";

let rootDir = "";

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "nakama-data-portability-test-"));
});

afterEach(async () => {
  if (rootDir) {
    await rm(rootDir, { force: true, recursive: true });
    rootDir = "";
  }
});

describe("Nakama data portability", () => {
  test("built-in Meet snapshots round-trip saved transcripts while excluding rollback and temporary audio", async () => {
    const directory = join(rootDir, "orgs", "a", "meet");
    const store = new MeetingStore(directory, "a");
    const meeting = store.importFile("notes.md", "Saved meeting", "alice");
    store.close();
    await writeFile(
      join(directory, "migration.json"),
      JSON.stringify({ orgId: "a" })
    );
    await mkdir(join(directory, "audio"), { recursive: true });
    await writeFile(join(directory, "audio", "temporary.wav"), "audio");
    await mkdir(join(rootDir, ".meet-rollback"), { recursive: true });
    await writeFile(join(rootDir, ".meet-rollback", "secret.json"), "secret");
    const exported = await createNakamaDataExport({
      databasePath: null,
      rootDir,
    });
    const files = Object.keys(fflate.unzipSync(exported.data));
    expect(files).toContain("orgs/a/meet/meetings.sqlite");
    expect(
      files.some(
        (path) => path.includes("audio/") || path.startsWith(".meet-rollback")
      )
    ).toBe(false);
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
      restored.close();
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
      const source = new Database(sourceDatabase, { create: true });
      source.exec(
        "CREATE TABLE org_plugins (org_id TEXT, plugin_id TEXT, lifecycle_state TEXT, revision INTEGER, pending_operation TEXT, updated_at TEXT)"
      );
      source.exec(
        "INSERT INTO org_plugins VALUES ('org-1', 'notes', 'enabled', 1, NULL, '2026-09-30T00:00:00.000Z')"
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
      const source = new Database(sourceDatabase, { create: true });
      source.exec(
        "CREATE TABLE org_plugins (org_id TEXT, plugin_id TEXT, lifecycle_state TEXT, revision INTEGER, pending_operation TEXT, updated_at TEXT)"
      );
      source.exec(
        "INSERT INTO org_plugins VALUES ('org-1', 'notes', 'enabled', 1, NULL, '2026-09-30T00:00:00.000Z')"
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
