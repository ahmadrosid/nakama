import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { runUpdateProfileMemory, MEMORY_MAX_BYTES } from "./profile-memory";

const PROFILE_CONTEXT = { orgId: "org_test", profileId: "profile_test" };
const originalConfigDir = process.env.TINYCLAW_CONFIG_DIR;

describe("update_profile_memory tool", () => {
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

  function setupTempDir(): string {
    tempDir = path.join(os.tmpdir(), "tinyclaw-memory-test-");
    return tempDir;
  }

  async function setupProfileDir(): Promise<string> {
    const dir = setupTempDir();
    await mkdir(path.join(dir, "orgs", "org_test", "profiles", "profile_test"), {
      recursive: true,
    });
    process.env.TINYCLAW_CONFIG_DIR = dir;
    return dir;
  }

  test("appends bullet under a new date section when MEMORY.md does not exist", async () => {
    const configDir = await setupProfileDir();
    const today = getTodayDate();
    const result = await runUpdateProfileMemory(
      { content: "User prefers dark mode." },
      PROFILE_CONTEXT,
    );

    expect(result.bytesTotal).toBeGreaterThan(0);
    expect(result.path).toEndWith("MEMORY.md");

    const content = await readFile(result.path, "utf8");
    expect(content).toStartWith("# Memory Log");
    expect(content).toContain(`## ${today}`);
    expect(content).toContain("- User prefers dark mode.");
  });

  test("creates proper template header when MEMORY.md does not exist", async () => {
    const configDir = await setupProfileDir();
    const result = await runUpdateProfileMemory(
      { content: "Test entry." },
      PROFILE_CONTEXT,
    );

    const content = await readFile(result.path, "utf8");
    expect(content).toStartWith("# Memory Log");
    expect(content).toContain("---");
  });

  test("appends a bullet under an existing today section", async () => {
    const configDir = await setupProfileDir();
    const today = getTodayDate();

    await runUpdateProfileMemory({ content: "First fact." }, PROFILE_CONTEXT);
    await runUpdateProfileMemory({ content: "Second fact." }, PROFILE_CONTEXT);

    const content = await readFile(
      path.join(configDir, "orgs", "org_test", "profiles", "profile_test", "MEMORY.md"),
      "utf8",
    );
    const todaySectionMatch = content.match(
      new RegExp(`## ${today}[\\s\\S]*?(?=\\n## |$)`),
    );
    expect(todaySectionMatch).not.toBeNull();
    expect(todaySectionMatch![0]).toContain("- First fact.");
    expect(todaySectionMatch![0]).toContain("- Second fact.");
  });

  test("handles multiple appends in the same date section", async () => {
    await setupProfileDir();

    await runUpdateProfileMemory({ content: "Fact one." }, PROFILE_CONTEXT);
    await runUpdateProfileMemory({ content: "Fact two." }, PROFILE_CONTEXT);
    await runUpdateProfileMemory({ content: "Fact three." }, PROFILE_CONTEXT);

    const content = await readFile(
      path.join(tempDir, "orgs", "org_test", "profiles", "profile_test", "MEMORY.md"),
      "utf8",
    );
    const bulletCount = (content.match(/- Fact/g) || []).length;
    expect(bulletCount).toBe(3);
  });

  test("rejects content that would exceed MEMORY_MAX_BYTES", async () => {
    await setupProfileDir();

    const largeContent = "x".repeat(MEMORY_MAX_BYTES);

    await expect(
      runUpdateProfileMemory({ content: largeContent }, PROFILE_CONTEXT),
    ).rejects.toThrow("Archive old entries with archive_profile_memory");
  });

  test("throws when profileId is missing from context", async () => {
    await expect(
      runUpdateProfileMemory({ content: "test" }, {}),
    ).rejects.toThrow("orgId and profileId are required.");
  });

  test("throws when content is empty", async () => {
    await setupProfileDir();

    await expect(
      runUpdateProfileMemory({ content: "" }, PROFILE_CONTEXT),
    ).rejects.toThrow("content is required.");
  });

  test("writes MEMORY.md to the profile soul directory", async () => {
    const configDir = await setupProfileDir();

    const result = await runUpdateProfileMemory(
      { content: "Profile isolation test." },
      PROFILE_CONTEXT,
    );

    expect(result.path).toBe(
      path.join(configDir, "orgs", "org_test", "profiles", "profile_test", "MEMORY.md"),
    );
  });
});

function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
