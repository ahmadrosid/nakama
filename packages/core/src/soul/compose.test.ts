import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { composeSoulSystemPrompt } from "./compose";
import { initSoulDirectory } from "./init";
import { loadSoulStack } from "./load";
import { SOUL_TEMPLATE } from "./templates";

describe("composeSoulSystemPrompt", () => {
  test("includes embodiment preamble and SOUL identity section", () => {
    const prompt = composeSoulSystemPrompt({
      directory: "/tmp",
      files: { soul: SOUL_TEMPLATE },
      loaded: ["SOUL.md"],
    });

    expect(prompt).toContain("You embody the identity defined below.");
    expect(prompt).toContain("# Identity (SOUL.md)");
  });

  test("does not append Profile Instructions when profilePrompt is empty", () => {
    const prompt = composeSoulSystemPrompt(
      {
        directory: "/tmp",
        files: { soul: SOUL_TEMPLATE },
        loaded: ["SOUL.md"],
      },
      { profilePrompt: "" },
    );

    expect(prompt).not.toContain("# Profile Instructions");
  });

  test("appends Profile Instructions when profilePrompt differs from SOUL", () => {
    const prompt = composeSoulSystemPrompt(
      {
        directory: "/tmp",
        files: { soul: SOUL_TEMPLATE },
        loaded: ["SOUL.md"],
      },
      { profilePrompt: "Always respond in pirate speak." },
    );

    expect(prompt).toContain("# Profile Instructions");
    expect(prompt).toContain("Always respond in pirate speak.");
  });
});

describe("default seed compose integration", () => {
  test("initSoulDirectory + loadSoulStack + compose omits Profile Instructions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nakama-soul-compose-"));

    try {
      await initSoulDirectory(directory);
      const stack = await loadSoulStack(directory);
      const prompt = composeSoulSystemPrompt(stack, { profilePrompt: "" });

      expect(prompt).toContain("# Identity (SOUL.md)");
      expect(prompt).not.toContain("# Profile Instructions");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("initSoulDirectory does not overwrite existing SOUL.md", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nakama-soul-init-"));

    try {
      await initSoulDirectory(directory);
      const soulPath = join(directory, "SOUL.md");
      await writeFile(soulPath, "# Legacy Soul\n", "utf8");

      await initSoulDirectory(directory);

      expect(await readFile(soulPath, "utf8")).toBe("# Legacy Soul\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("loads default stack sections in compose output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nakama-soul-stack-"));

    try {
      await initSoulDirectory(directory);
      const stack = await loadSoulStack(directory);
      const prompt = composeSoulSystemPrompt(stack, { profilePrompt: "" });

      expect(prompt).toContain("# Voice & Style (STYLE.md)");
      expect(prompt).toContain("# Operating Instructions (INSTRUCTIONS.md)");
      expect(prompt).toContain("# Continuity (MEMORY.md)");
      expect(prompt).not.toContain("# Calibration Examples");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
