import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBundledSkillMarkdown } from "./index";
import { ensureBundledSkillFiles } from "./install";

describe("ensureBundledSkillFiles for agent-browser", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-agent-browser-skills-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    await mkdir(join(configDir, "agent", "skills"), { recursive: true });
  });

  afterEach(() => {
    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("writes agent-browser when missing", async () => {
    const created = await ensureBundledSkillFiles();
    expect(created).toContain("agent-browser");
  });

  test("force-refreshes agent-browser when the installed copy is stale", async () => {
    const skillPath = join(
      configDir,
      "agent",
      "skills",
      "agent-browser",
      "SKILL.md"
    );
    await mkdir(join(configDir, "agent", "skills", "agent-browser"), {
      recursive: true,
    });
    await Bun.write(
      skillPath,
      "---\nname: agent-browser\ndescription: stale\n---\n"
    );

    const created = await ensureBundledSkillFiles();
    const content = await readFile(skillPath, "utf8");

    expect(created).toContain("agent-browser");
    expect(content).toContain("AGENT_BROWSER_EXECUTABLE_PATH");
    expect(content).not.toContain("description: stale");
  });
});

describe("bundled agent-browser skill", () => {
  test("teaches Cloak as an optional host Chromium override", async () => {
    const content = await readBundledSkillMarkdown("agent-browser");
    expect(content).toContain("CloakBrowser");
    expect(content).toContain("AGENT_BROWSER_EXECUTABLE_PATH");
    expect(content).toContain("AGENT_BROWSER_ARGS");
    expect(content).toContain("agent-browser install");
  });
});
