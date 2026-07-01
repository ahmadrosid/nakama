import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { runArchiveProfileMemory } from "./archive-profile-memory";

const PROFILE_CONTEXT = { orgId: "org_test", profileId: "profile_test" };
const originalConfigDir = process.env.TINYCLAW_CONFIG_DIR;

describe("archive_profile_memory tool", () => {
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

  async function setupProfileMemory(content: string): Promise<void> {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-archive-tool-"));
    const soulDir = path.join(tempDir, "orgs", "org_test", "profiles", "profile_test");
    await mkdir(soulDir, { recursive: true });
    await writeFile(path.join(soulDir, "MEMORY.md"), content, "utf8");
    process.env.TINYCLAW_CONFIG_DIR = tempDir;
  }

  test("archives matching bullets and returns active byte count", async () => {
    await setupProfileMemory(`# Memory Log

---

## 2026-06-29

- Old preference.
- Current preference.
`);

    const result = await runArchiveProfileMemory(
      { entries: ["Old preference."] },
      PROFILE_CONTEXT,
    );

    expect(result.archived).toBe(1);
    expect(result.activeBytes).toBeGreaterThan(0);
    expect(result.archivePath).toContain("memory-archive");

    const active = await readFile(
      path.join(tempDir, "orgs", "org_test", "profiles", "profile_test", "MEMORY.md"),
      "utf8",
    );
    expect(active).toContain("- Current preference.");
    expect(active).not.toContain("- Old preference.");
  });

  test("throws when orgId and profileId are missing", async () => {
    await expect(
      runArchiveProfileMemory({ entries: ["Fact."] }, {}),
    ).rejects.toThrow("orgId and profileId are required.");
  });

  test("throws when entries is empty", async () => {
    await setupProfileMemory(`# Memory Log

---

## 2026-06-29

- Fact.
`);

    await expect(
      runArchiveProfileMemory({ entries: [] }, PROFILE_CONTEXT),
    ).rejects.toThrow("entries must include at least one item.");
  });
});
