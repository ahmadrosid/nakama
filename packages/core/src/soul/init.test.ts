import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { initSoulDirectory, isLegacySoulPlaceholder } from "./init";
import { loadSoulStack } from "./load";
import { SOUL_TEMPLATE } from "./templates";

describe("isLegacySoulPlaceholder", () => {
  test("detects old scaffold markers", () => {
    expect(isLegacySoulPlaceholder("# Your Name\n\n[Belief 1]")).toBe(true);
    expect(isLegacySoulPlaceholder("")).toBe(true);
    expect(isLegacySoulPlaceholder("   ")).toBe(true);
  });

  test("accepts filled Default Bot soul", () => {
    expect(isLegacySoulPlaceholder(SOUL_TEMPLATE)).toBe(false);
  });
});

describe("initSoulDirectory seeding", () => {
  test("fills an empty SOUL.md on init", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nakama-soul-empty-"));

    try {
      await writeFile(join(directory, "SOUL.md"), "\n", "utf8");
      await initSoulDirectory(directory);

      const soul = await readFile(join(directory, "SOUL.md"), "utf8");
      expect(soul).toContain("# Default Bot");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("upgrades legacy placeholder SOUL.md", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nakama-soul-legacy-"));

    try {
      await writeFile(join(directory, "SOUL.md"), "# Your Name\n\n[Belief 1]\n", "utf8");
      await initSoulDirectory(directory);

      const soul = await readFile(join(directory, "SOUL.md"), "utf8");
      expect(soul).toContain("# Default Bot");
      expect(soul).not.toContain("# Your Name");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("does not overwrite customized SOUL.md", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nakama-soul-custom-"));

    try {
      await writeFile(join(directory, "SOUL.md"), "# My Custom Bot\n\nCustom identity.\n", "utf8");
      await initSoulDirectory(directory);

      expect(await readFile(join(directory, "SOUL.md"), "utf8")).toBe(
        "# My Custom Bot\n\nCustom identity.\n",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("creates full stack for first install", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nakama-soul-first-install-"));

    try {
      const result = await initSoulDirectory(directory);
      const stack = await loadSoulStack(directory);

      expect(result.created).toEqual([
        "SOUL.md",
        "STYLE.md",
        "INSTRUCTIONS.md",
        "MEMORY.md",
        "examples/good-outputs.md",
        "examples/bad-outputs.md",
      ]);
      expect(stack.files.soul).toContain("# Default Bot");
      expect(stack.loaded.length).toBeGreaterThan(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
