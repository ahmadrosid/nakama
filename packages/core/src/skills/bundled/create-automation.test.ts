import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBundledSkillMarkdown } from "./index";
import { ensureBundledSkillFiles } from "./install";

describe("ensureBundledSkillFiles", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-bundled-skills-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    await mkdir(join(configDir, "agent", "skills"), { recursive: true });
  });

  afterEach(() => {
    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("writes bundled skills when missing", async () => {
    const created = await ensureBundledSkillFiles();

    expect(created).toContain("create-automation");
    expect(created).toContain("manage-skills");
    expect(created).toContain("update-profile-memory");
    expect(created).toContain("archive-profile-memory");
    expect(created).toContain("save-artifact");
    expect(created).toContain("create-profile");
    expect(created).toContain("coding-agent");
    expect(created).toContain("coding-backend-codex");
    expect(created).toContain("coding-backend-claude-code");
    expect(created).toContain("coding-backend-opencode");
    expect(created).toContain("coding-backend-pi");
    expect(created).toContain("coding-backend-cursor");
  });

  test("does not overwrite existing skill files", async () => {
    const skillPath = join(
      configDir,
      "agent",
      "skills",
      "create-automation",
      "SKILL.md"
    );
    await mkdir(join(configDir, "agent", "skills", "create-automation"), {
      recursive: true,
    });
    await Bun.write(
      skillPath,
      "---\nname: create-automation\ndescription: custom\n---\n"
    );

    const created = await ensureBundledSkillFiles();

    expect(created).not.toContain("create-automation");
    expect(await readFile(skillPath, "utf8")).toContain("description: custom");
  });

  test("force-refreshes manage-skills even when an installed copy exists", async () => {
    const skillPath = join(
      configDir,
      "agent",
      "skills",
      "manage-skills",
      "SKILL.md"
    );
    await mkdir(join(configDir, "agent", "skills", "manage-skills"), {
      recursive: true,
    });
    await Bun.write(
      skillPath,
      "---\nname: manage-skills\ndescription: stale\n---\n"
    );

    const created = await ensureBundledSkillFiles();
    const content = await readFile(skillPath, "utf8");

    expect(created).toContain("manage-skills");
    expect(content).toContain("skill_manage");
    expect(content).not.toContain("description: stale");
  });

  test("refreshes an installed save-artifact skill on startup", async () => {
    const directory = join(configDir, "agent", "skills", "save-artifact");
    const skillPath = join(directory, "SKILL.md");
    await mkdir(directory, { recursive: true });
    await Bun.write(skillPath, "outdated bundled skill");

    const refreshed = await ensureBundledSkillFiles();

    expect(refreshed).toContain("save-artifact");
    expect(await readFile(skillPath, "utf8")).toBe(
      await readBundledSkillMarkdown("save-artifact")
    );
  });
});
