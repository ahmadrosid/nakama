import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  });
});

function buildUnsafeZip(): Buffer {
  const safe = Buffer.from("{}", "utf8");
  const name = "../escape.txt";
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
