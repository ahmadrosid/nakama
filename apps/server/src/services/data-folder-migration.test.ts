import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach } from "bun:test";
import { runDataFolderMigration } from "./data-folder-migration";

describe("runDataFolderMigration", () => {
  let rootDir = "";

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
      rootDir = "";
    }
  });

  test("migrates legacy profile data folders and removes empty leftovers", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "tinyclaw-folder-migration-"));
    const profileDir = join(rootDir, "orgs", "org_test", "profiles", "profile_one");
    const legacyKbDir = join(profileDir, "data", "knowledge-base");
    const legacyUploadsDir = join(legacyKbDir, "uploads", "kb_doc");
    const legacyExtractedDir = join(legacyKbDir, "extracted");
    const legacyMemoryDir = join(profileDir, "data", "memory-archive");

    await mkdir(legacyUploadsDir, { recursive: true });
    await mkdir(legacyExtractedDir, { recursive: true });
    await mkdir(legacyMemoryDir, { recursive: true });
    await writeFile(
      join(legacyKbDir, "manifest.json"),
      JSON.stringify({
        documents: [
          {
            id: "kb_doc",
            filename: "notes.txt",
            mediaType: "text/plain",
            sizeBytes: 12,
            uploadedAt: "2026-07-01T00:00:00.000Z",
            status: "ready",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(join(legacyUploadsDir, "notes.txt"), "hello world", "utf8");
    await writeFile(join(legacyExtractedDir, "kb_doc.txt"), "# source: notes.txt\n\nhello world", "utf8");
    await writeFile(join(legacyMemoryDir, "2026-07.md"), "# Archived Memory", "utf8");

    const result = await runDataFolderMigration({ configRoot: rootDir });

    expect(result.profilesScanned).toBe(1);
    expect(result.profilesChanged).toBe(1);
    expect(result.filesMoved).toBeGreaterThanOrEqual(2);
    expect(result.foldersRemoved).toBeGreaterThanOrEqual(3);
    await expect(readFile(join(profileDir, "knowledge-base", "manifest.json"), "utf8")).resolves.toContain("\"kb_doc\"");
    await expect(readFile(join(profileDir, "knowledge-base", "kb_doc--notes.txt"), "utf8")).resolves.toBe("hello world");
    await expect(readFile(join(profileDir, "knowledge-base", "kb_doc.extracted.txt"), "utf8")).resolves.toContain("hello world");
    await expect(readFile(join(profileDir, "memory-archive", "2026-07.md"), "utf8")).resolves.toContain("# Archived Memory");
    await expect(readFile(join(profileDir, "data", "knowledge-base", "manifest.json"), "utf8")).rejects.toThrow();
    expect(result.logs.some((entry) => entry.message.includes("Moved"))).toBe(true);
  });
});
