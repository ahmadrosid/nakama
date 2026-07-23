import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchSkillsForMessage } from "../match";
import { parseSkillMarkdown } from "../parse";
import { readBundledSkillMarkdown } from "./index";
import { ensureBundledSkillFiles } from "./install";

describe("bundled coding-agent skill", () => {
  test("description matches code-change requests but not plain explainers", async () => {
    const content = await readBundledSkillMarkdown("coding-agent");
    const parsed = parseSkillMarkdown(content, "coding-agent/SKILL.md");
    const discovered = {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      disableModelInvocation: false,
      includeBodyOnMatch: true,
      directory: "/tmp/coding-agent",
      skillFilePath: "/tmp/coding-agent/SKILL.md",
      body: parsed.body,
      hasTool: false,
      toolPath: null,
    };

    expect(
      matchSkillsForMessage([discovered], "Fix the failing auth tests in this repository").map(
        (skill) => skill.name,
      ),
    ).toEqual(["coding-agent"]);

    expect(
      matchSkillsForMessage([discovered], "Explain how TLS session resumption works").map(
        (skill) => skill.name,
      ),
    ).toEqual([]);
  });
});

describe("ensureBundledSkillFiles for coding agent", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-coding-agent-skills-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    await mkdir(join(configDir, "agent", "skills"), { recursive: true });
  });

  afterEach(() => {
    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("writes coding agent bundled skills when missing", async () => {
    const created = await ensureBundledSkillFiles();

    expect(created).toContain("coding-agent");
    expect(created).toContain("coding-backend-codex");
    expect(created).toContain("coding-backend-claude-code");
    expect(created).toContain("coding-backend-opencode");
  });
});
