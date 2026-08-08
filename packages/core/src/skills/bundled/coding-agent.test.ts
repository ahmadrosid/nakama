import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
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
      body: parsed.body,
      description: parsed.frontmatter.description,
      directory: "/tmp/coding-agent",
      disableModelInvocation: false,
      hasTool: false,
      includeBodyOnMatch: true,
      name: parsed.frontmatter.name,
      skillFilePath: "/tmp/coding-agent/SKILL.md",
      toolPath: null,
    };

    expect(
      matchSkillsForMessage(
        [discovered],
        "Fix the failing auth tests in this repository"
      ).map((skill) => skill.name)
    ).toEqual(["coding-agent"]);

    expect(
      matchSkillsForMessage(
        [discovered],
        "Explain how TLS session resumption works"
      ).map((skill) => skill.name)
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
    expect(created).toContain("coding-backend-pi");
    expect(created).toContain("coding-backend-cursor");
  });

  test("force-refreshes coding-agent and coding-backend-cursor when installed copies are stale", async () => {
    const codingAgentPath = join(
      configDir,
      "agent",
      "skills",
      "coding-agent",
      "SKILL.md"
    );
    const cursorPath = join(
      configDir,
      "agent",
      "skills",
      "coding-backend-cursor",
      "SKILL.md"
    );
    await mkdir(join(configDir, "agent", "skills", "coding-agent"), {
      recursive: true,
    });
    await mkdir(join(configDir, "agent", "skills", "coding-backend-cursor"), {
      recursive: true,
    });
    await Bun.write(
      codingAgentPath,
      "---\nname: coding-agent\ndescription: stale\n---\n"
    );
    await Bun.write(
      cursorPath,
      "---\nname: coding-backend-cursor\ndescription: stale\n---\n"
    );

    const created = await ensureBundledSkillFiles();
    const codingAgent = await readFile(codingAgentPath, "utf8");
    const cursor = await readFile(cursorPath, "utf8");

    expect(created).toContain("coding-agent");
    expect(created).toContain("coding-backend-cursor");
    expect(codingAgent).toContain("gh pr create");
    expect(codingAgent).not.toContain("description: stale");
    expect(cursor).toContain("Commits and pull requests");
    expect(cursor).toContain("open a PR with gh");
    expect(cursor).not.toContain("description: stale");
  });
});
