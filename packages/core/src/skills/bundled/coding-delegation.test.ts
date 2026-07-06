import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchSkillsForMessage } from "../match";
import { parseSkillMarkdown } from "../parse";
import { readBundledSkillBody, readBundledSkillMarkdown } from "./index";
import { ensureBundledSkillFiles } from "./install";

describe("bundled coding-delegation skill", () => {
  test("parses bundled markdown", async () => {
    const content = await readBundledSkillMarkdown("coding-delegation");
    const parsed = parseSkillMarkdown(content, "coding-delegation/SKILL.md");

    expect(parsed.frontmatter.name).toBe("coding-delegation");
    expect(parsed.frontmatter.includeBodyOnMatch).toBe(true);
    expect(parsed.body).toContain("Keep ordinary conversation local");
    expect(parsed.body).toContain("After the coding agent returns");
  });

  test("description matches code-change requests but not plain explainers", async () => {
    const content = await readBundledSkillMarkdown("coding-delegation");
    const parsed = parseSkillMarkdown(content, "coding-delegation/SKILL.md");
    const discovered = {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      disableModelInvocation: false,
      includeBodyOnMatch: true,
      directory: "/tmp/coding-delegation",
      skillFilePath: "/tmp/coding-delegation/SKILL.md",
      body: parsed.body,
      hasTool: false,
      toolPath: null,
    };

    expect(
      matchSkillsForMessage([discovered], "Fix the failing auth tests in this repository").map(
        (skill) => skill.name,
      ),
    ).toEqual(["coding-delegation"]);

    expect(
      matchSkillsForMessage([discovered], "Explain how TLS session resumption works").map(
        (skill) => skill.name,
      ),
    ).toEqual([]);
  });
});

describe("bundled coding backend skills", () => {
  test("exposes backend-specific prompt bodies", async () => {
    expect(await readBundledSkillBody("coding-backend-codex")).toContain("Codex CLI");
    expect(await readBundledSkillBody("coding-backend-claude-code")).toContain("Claude Code");
    expect(await readBundledSkillBody("coding-backend-opencode")).toContain("OpenCode");
  });
});

describe("ensureBundledSkillFiles for coding delegation", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-coding-delegation-skills-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    await mkdir(join(configDir, "agent", "skills"), { recursive: true });
  });

  afterEach(() => {
    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("writes coding delegation bundled skills when missing", async () => {
    const created = await ensureBundledSkillFiles();

    expect(created).toContain("coding-delegation");
    expect(created).toContain("coding-backend-codex");
    expect(created).toContain("coding-backend-claude-code");
    expect(created).toContain("coding-backend-opencode");

    const content = await readFile(
      join(configDir, "agent", "skills", "coding-delegation", "SKILL.md"),
      "utf8",
    );

    expect(content).toContain("name: coding-delegation");
  });
});
