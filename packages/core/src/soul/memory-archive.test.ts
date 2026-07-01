import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  archiveProfileMemoryBullets,
  formatArchiveAppend,
  parseMemoryContent,
  partitionMemoryEntries,
  rebuildMemoryContent,
} from "./memory-archive";
import { getMemoryArchiveFilePath } from "./memory-paths";

const PROFILE = { orgId: "org_test", profileId: "profile_test" };
const originalConfigDir = process.env.TINYCLAW_CONFIG_DIR;

describe("memory archive", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
    if (originalConfigDir === undefined) {
      delete process.env.TINYCLAW_CONFIG_DIR;
    } else {
      process.env.TINYCLAW_CONFIG_DIR = originalConfigDir;
    }
  });

  async function setupProfileMemory(content: string): Promise<string> {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-memory-archive-"));
    const soulDir = path.join(tempDir, "orgs", PROFILE.orgId, "profiles", PROFILE.profileId);
    await mkdir(soulDir, { recursive: true });
    await writeFile(path.join(soulDir, "MEMORY.md"), content, "utf8");
    process.env.TINYCLAW_CONFIG_DIR = tempDir;
    return soulDir;
  }

  test("parseMemoryContent reads dated sections and bullets", () => {
    const parsed = parseMemoryContent(`# Memory Log

---

## 2026-06-28

- Older fact.

## 2026-06-29

- Active fact.
`);

    expect(parsed.preamble).toContain("# Memory Log");
    expect(parsed.sections).toEqual([
      { date: "2026-06-28", bullets: ["Older fact."] },
      { date: "2026-06-29", bullets: ["Active fact."] },
    ]);
  });

  test("partitionMemoryEntries moves matching bullets to archive sections", () => {
    const parsed = parseMemoryContent(`# Memory Log

---

## 2026-06-28

- Remove me.

## 2026-06-29

- Keep me.
- Remove me too.
`);

    const result = partitionMemoryEntries(parsed, ["Remove me.", "Remove me too."]);

    expect(result.archivedCount).toBe(2);
    expect(result.unmatched).toEqual([]);
    expect(result.active.sections).toEqual([
      { date: "2026-06-29", bullets: ["Keep me."] },
    ]);
    expect(result.archivedSections).toEqual([
      { date: "2026-06-28", bullets: ["Remove me."] },
      { date: "2026-06-29", bullets: ["Remove me too."] },
    ]);
  });

  test("rebuildMemoryContent drops empty date sections", () => {
    const rebuilt = rebuildMemoryContent({
      preamble: "# Memory Log\n\n---",
      sections: [{ date: "2026-06-29", bullets: ["Still here."] }],
    });

    expect(rebuilt).toContain("## 2026-06-29");
    expect(rebuilt).toContain("- Still here.");
    expect(rebuilt).not.toContain("2026-06-28");
  });

  test("formatArchiveAppend preserves original section dates", () => {
    const append = formatArchiveAppend(
      new Date("2026-06-29T12:00:00.000Z"),
      [{ date: "2026-06-15", bullets: ["Old preference."] }],
      "user cleanup",
    );

    expect(append).toContain("<!-- archived: 2026-06-29T12:00:00.000Z -->");
    expect(append).toContain("<!-- reason: user cleanup -->");
    expect(append).toContain("## 2026-06-15");
    expect(append).toContain("- Old preference.");
  });

  test("archiveProfileMemoryBullets moves entries to memory-archive", async () => {
    await setupProfileMemory(`# Memory Log

---

## 2026-06-29

- User prefers dark mode.
- User lives in Jakarta.
`);

    const archivedAt = new Date("2026-06-29T15:00:00.000Z");
    const result = await archiveProfileMemoryBullets(
      PROFILE.orgId,
      PROFILE.profileId,
      ["User prefers dark mode."],
      { archivedAt, reason: "no longer relevant" },
    );

    expect(result.archived).toBe(1);
    expect(result.activeBytes).toBeGreaterThan(0);
    expect(result.archivePath).toEndWith(
      path.join("memory-archive", "2026-06.md"),
    );

    const active = await readFile(
      path.join(tempDir, "orgs", PROFILE.orgId, "profiles", PROFILE.profileId, "MEMORY.md"),
      "utf8",
    );
    expect(active).not.toContain("User prefers dark mode.");
    expect(active).toContain("- User lives in Jakarta.");

    const archive = await readFile(result.archivePath, "utf8");
    expect(archive).toContain("# Archived Memory");
    expect(archive).toContain("- User prefers dark mode.");
    expect(archive).toContain("<!-- reason: no longer relevant -->");
  });

  test("archiveProfileMemoryBullets appends to an existing archive file", async () => {
    await setupProfileMemory(`# Memory Log

---

## 2026-06-29

- First archived.
- Keep active.
`);

    const archivePath = getMemoryArchiveFilePath(PROFILE.orgId, PROFILE.profileId, "2026-06");
    await mkdir(path.dirname(archivePath), { recursive: true });
    await writeFile(archivePath, "# Archived Memory\n\n---\n\n<!-- archived: 2026-06-01T00:00:00.000Z -->\n", "utf8");

    await archiveProfileMemoryBullets(
      PROFILE.orgId,
      PROFILE.profileId,
      ["First archived."],
      { archivedAt: new Date("2026-06-29T16:00:00.000Z") },
    );

    const archive = await readFile(archivePath, "utf8");
    expect(archive).toContain("<!-- archived: 2026-06-01T00:00:00.000Z -->");
    expect(archive).toContain("<!-- archived: 2026-06-29T16:00:00.000Z -->");
    expect(archive).toContain("- First archived.");
  });

  test("archiveProfileMemoryBullets rejects unmatched entries", async () => {
    await setupProfileMemory(`# Memory Log

---

## 2026-06-29

- Known fact.
`);

    await expect(
      archiveProfileMemoryBullets(PROFILE.orgId, PROFILE.profileId, ["Missing fact."]),
    ).rejects.toThrow("Memory entries not found: Missing fact.");
  });

  test("archiveProfileMemoryBullets migrates legacy data/memory-archive", async () => {
    const soulDir = await setupProfileMemory(`# Memory Log

---

## 2026-06-29

- Move this.
`);
    const legacyArchiveDir = path.join(soulDir, "data", "memory-archive");
    await mkdir(legacyArchiveDir, { recursive: true });
    await writeFile(
      path.join(legacyArchiveDir, "2026-06.md"),
      "# Archived Memory\n\n---\n\n<!-- archived: 2026-06-01T00:00:00.000Z -->\n",
      "utf8",
    );

    const result = await archiveProfileMemoryBullets(
      PROFILE.orgId,
      PROFILE.profileId,
      ["Move this."],
      { archivedAt: new Date("2026-06-29T16:00:00.000Z") },
    );

    expect(result.archivePath).toEndWith(path.join("memory-archive", "2026-06.md"));
    const archive = await readFile(result.archivePath, "utf8");
    expect(archive).toContain("<!-- archived: 2026-06-01T00:00:00.000Z -->");
    expect(archive).toContain("- Move this.");
    await expect(readFile(path.join(legacyArchiveDir, "2026-06.md"), "utf8")).rejects.toThrow();
  });
});
