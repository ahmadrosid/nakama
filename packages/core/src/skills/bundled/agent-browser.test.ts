import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUNDLED_SKILL_NAMES,
  DEFAULT_BUNDLED_SKILL_NAMES,
  OPT_IN_BUNDLED_SKILL_NAMES,
  SUPER_BOT_BUNDLED_SKILL_NAMES,
} from "../bundled-names";
import { matchSkillsForMessage } from "../match";
import { parseSkillMarkdown } from "../parse";
import { readBundledSkillMarkdown } from "./index";
import { ensureBundledSkillFiles } from "./install";

describe("bundled agent-browser skill", () => {
  test("parses and documents bash workflow, install, and missing-CLI guidance", async () => {
    const content = await readBundledSkillMarkdown("agent-browser");
    const parsed = parseSkillMarkdown(content, "agent-browser/SKILL.md");

    expect(parsed.frontmatter.name).toBe("agent-browser");
    expect(parsed.frontmatter.disableModelInvocation).toBeFalsy();
    expect(parsed.frontmatter.includeBodyOnMatch).toBe(true);
    expect(parsed.body).toContain("bash");
    expect(parsed.body).toContain("snapshot");
    expect(parsed.body).toContain("close");
    expect(parsed.body).toMatch(/npm install -g agent-browser/);
    expect(parsed.body).toMatch(/ENOENT|command not found/i);
    expect(parsed.body).toContain("timeoutMs");
    expect(parsed.body).toContain("artifacts/");
  });

  test("description matches interactive browse requests but not plain fetch or explainers", async () => {
    const content = await readBundledSkillMarkdown("agent-browser");
    const parsed = parseSkillMarkdown(content, "agent-browser/SKILL.md");
    const discovered = {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      disableModelInvocation: false,
      includeBodyOnMatch: true,
      directory: "/tmp/agent-browser",
      skillFilePath: "/tmp/agent-browser/SKILL.md",
      body: parsed.body,
      hasTool: false,
      toolPath: null,
    };

    expect(
      matchSkillsForMessage(
        [discovered],
        "Login to our vendor portal and check the latest order status in the browser",
      ).map((skill) => skill.name),
    ).toEqual(["agent-browser"]);

    expect(
      matchSkillsForMessage([discovered], "Explain how TLS session resumption works").map(
        (skill) => skill.name,
      ),
    ).toEqual([]);

    expect(
      matchSkillsForMessage(
        [discovered],
        "Fetch https://example.com and summarize the homepage",
      ).map((skill) => skill.name),
    ).toEqual([]);
  });

  test("is opt-in only in the bundled name registry", () => {
    expect(OPT_IN_BUNDLED_SKILL_NAMES).toContain("agent-browser");
    expect(BUNDLED_SKILL_NAMES).toContain("agent-browser");
    expect(DEFAULT_BUNDLED_SKILL_NAMES).not.toContain("agent-browser");
    expect(SUPER_BOT_BUNDLED_SKILL_NAMES).not.toContain("agent-browser");
  });
});

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
});
