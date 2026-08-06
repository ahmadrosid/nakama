import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createNakamaDataExport,
  previewNakamaDataImport,
  restoreNakamaDataImport,
  NAKAMA_EXPORT_MANIFEST,
} from "./data-portability";

let rootDir = "";

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "nakama-data-portability-test-"));
});

afterEach(async () => {
  if (rootDir) {
    await rm(rootDir, { recursive: true, force: true });
    rootDir = "";
  }
});

describe("Nakama data portability", () => {
  test("exports config root content with a manifest", async () => {
    await writeFile(join(rootDir, "config.ini"), "provider=openai");
    await writeFile(join(rootDir, "nakama.db"), "sqlite");
    await writeFile(join(rootDir, "tools.js"), "module.exports = {}");

    const result = await createNakamaDataExport({
      rootDir,
      now: new Date("2026-07-01T10:00:00.000Z"),
    });
    const preview = await previewNakamaDataImport(result.data, { rootDir });

    expect(result.filename).toBe("nakama-export-2026-07-01T10-00-00-000Z.zip");
    expect(result.manifest.kind).toBe("nakama-export");
    expect(result.manifest.topLevelPaths).toEqual(["config.ini", "nakama.db", "tools.js"]);
    expect(preview.manifest.createdAt).toBe("2026-07-01T10:00:00.000Z");
    expect(preview.archiveFileCount).toBe(3);
    expect(preview.topLevelPaths).toEqual(["config.ini", "nakama.db", "tools.js"]);
  });

  test("reports external database paths without copying them", async () => {
    const outsideDb = join(await mkdtemp(join(tmpdir(), "nakama-external-db-")), "nakama.db");
    await writeFile(join(rootDir, "config.ini"), "ok");

    try {
      const result = await createNakamaDataExport({ rootDir, databasePath: outsideDb });
      expect(result.manifest.skipped).toEqual([
        {
          path: outsideDb,
          reason: "Database path is outside the Nakama root.",
        },
      ]);
    } finally {
      await rm(join(outsideDb, ".."), { recursive: true, force: true });
    }
  });

  test("preview does not mutate existing data and restore replaces it after confirmation", async () => {
    await writeFile(join(rootDir, "config.ini"), "original");
    const exportResult = await createNakamaDataExport({ rootDir });

    await writeFile(join(rootDir, "config.ini"), "changed");
    await writeFile(join(rootDir, "extra.txt"), "remove me");

    const preview = await previewNakamaDataImport(exportResult.data, { rootDir });
    expect(preview.willReplaceRoot).toBe(true);
    expect(await readFile(join(rootDir, "config.ini"), "utf8")).toBe("changed");

    const restore = await restoreNakamaDataImport(exportResult.data, {
      rootDir,
      confirm: true,
    });

    expect(restore.restoredFileCount).toBe(1);
    expect(await readFile(join(rootDir, "config.ini"), "utf8")).toBe("original");
    await expect(readFile(join(rootDir, "extra.txt"), "utf8")).rejects.toThrow();
    await expect(readFile(join(rootDir, NAKAMA_EXPORT_MANIFEST), "utf8")).rejects.toThrow();
  });

  test("restore keeps the root directory inode so volume mounts stay put", async () => {
    await writeFile(join(rootDir, "config.ini"), "original");
    const exportResult = await createNakamaDataExport({ rootDir });
    await writeFile(join(rootDir, "config.ini"), "changed");
    const before = await lstat(rootDir);

    await restoreNakamaDataImport(exportResult.data, { rootDir, confirm: true });

    const after = await lstat(rootDir);
    expect(after.dev).toBe(before.dev);
    expect(after.ino).toBe(before.ino);
    expect(await readFile(join(rootDir, "config.ini"), "utf8")).toBe("original");

    const leftovers = (await readdir(rootDir)).filter(
      (name) => name.startsWith(".nakama-backup-") || name.startsWith(".nakama-restore-"),
    );
    expect(leftovers).toEqual([]);
  });

  test("restore requires explicit confirmation", async () => {
    await writeFile(join(rootDir, "config.ini"), "original");
    const exportResult = await createNakamaDataExport({ rootDir });

    await expect(
      restoreNakamaDataImport(exportResult.data, { rootDir, confirm: false }),
    ).rejects.toThrow("Restore confirmation is required.");
  });

  test("rejects malformed archives and unsafe entry paths", async () => {
    await expect(previewNakamaDataImport(Buffer.from("not a zip"), { rootDir })).rejects.toThrow(
      "Invalid ZIP archive.",
    );

    const unsafe = buildUnsafeZip();
    await expect(previewNakamaDataImport(unsafe, { rootDir })).rejects.toThrow(
      "Archive entry escapes restore root",
    );

    const reserved = buildZipWithEntry(".nakama-backup-evil/secret.txt", "{}");
    await expect(previewNakamaDataImport(reserved, { rootDir })).rejects.toThrow(
      "Archive entry uses a reserved restore path",
    );
  });

  test("partial backup failure does not delete unbacked siblings", async () => {
    await writeFile(join(rootDir, "keep.ini"), "keep-me");
    await writeFile(join(rootDir, "move.ini"), "move-me");
    const exportResult = await createNakamaDataExport({ rootDir });

    const fsPromises = await import("node:fs/promises");
    const originalRename = fsPromises.rename;
    const { spyOn } = await import("bun:test");
    const renameMock = spyOn(fsPromises, "rename").mockImplementation(async (from, to) => {
      const toPath = String(to);
      if (toPath.includes(".nakama-backup-") && toPath.endsWith("move.ini")) {
        throw Object.assign(new Error("simulated backup failure"), { code: "EIO" });
      }
      return originalRename(from, to);
    });

    try {
      await expect(
        restoreNakamaDataImport(exportResult.data, { rootDir, confirm: true }),
      ).rejects.toThrow("simulated backup failure");

      await expect(readFile(join(rootDir, "keep.ini"), "utf8")).resolves.toBe("keep-me");
      await expect(readFile(join(rootDir, "move.ini"), "utf8")).resolves.toBe("move-me");
    } finally {
      renameMock.mockRestore();
    }
  });
});

function buildZipWithEntry(name: string, content: string): Buffer {
  const safe = Buffer.from(content, "utf8");
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x0800, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt32LE(safe.length, 18);
  localHeader.writeUInt32LE(safe.length, 22);
  localHeader.writeUInt16LE(Buffer.byteLength(name), 26);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0x0800, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt32LE(safe.length, 20);
  centralHeader.writeUInt32LE(safe.length, 24);
  centralHeader.writeUInt16LE(Buffer.byteLength(name), 28);

  const centralOffset = localHeader.length + Buffer.byteLength(name) + safe.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralHeader.length + Buffer.byteLength(name), 12);
  end.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([
    localHeader,
    Buffer.from(name),
    safe,
    centralHeader,
    Buffer.from(name),
    end,
  ]);
}

function buildUnsafeZip(): Buffer {
  return buildZipWithEntry("../escape.txt", "{}");
}
