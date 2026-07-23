import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchSkillsForMessage } from "../match";
import { parseSkillMarkdown } from "../parse";
import { readBundledSkillMarkdown } from "./index";
import { ensureBundledSkillFiles } from "./install";

describe("bundled create-automation skill", () => {
  test("description matches scheduling messages", async () => {
    const content = await readBundledSkillMarkdown("create-automation");
    const parsed = parseSkillMarkdown(content, "create-automation/SKILL.md");
    const discovered = {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      disableModelInvocation: false,
      includeBodyOnMatch: true,
      directory: "/tmp/create-automation",
      skillFilePath: "/tmp/create-automation/SKILL.md",
      body: parsed.body,
      hasTool: false,
      toolPath: null,
    };

    expect(
      matchSkillsForMessage([discovered], "Remind me every weekday at 8am to check email").map(
        (skill) => skill.name,
      ),
    ).toEqual(["create-automation"]);
  });
});

describe("bundled create-profile skill", () => {
  test("description matches profile creation messages", async () => {
    const content = await readBundledSkillMarkdown("create-profile");
    const parsed = parseSkillMarkdown(content, "create-profile/SKILL.md");
    const discovered = {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      disableModelInvocation: false,
      includeBodyOnMatch: true,
      directory: "/tmp/create-profile",
      skillFilePath: "/tmp/create-profile/SKILL.md",
      body: parsed.body,
      hasTool: false,
      toolPath: null,
    };

    expect(
      matchSkillsForMessage([discovered], "Create a support bot profile for billing").map(
        (skill) => skill.name,
      ),
    ).toEqual(["create-profile"]);
  });

  test("body requires draft-and-confirm before create_profile", async () => {
    const content = await readBundledSkillMarkdown("create-profile");
    const parsed = parseSkillMarkdown(content, "create-profile/SKILL.md");
    const body = parsed.body.toLowerCase();

    expect(body).toContain("draft");
    expect(body).toMatch(/confirm|confirmation|explicit/);
    expect(body).toContain("create_profile");
    expect(body).not.toMatch(/otherwise proceed/);
    expect(body).toContain("memory.md");
    expect(body).toMatch(/empty/);
    expect(body).toContain("web_fetch");
    expect(body).toMatch(/isSuper|is super|super profile/i);
    expect(body).toMatch(/revise|edit/);
    expect(body).toMatch(/open|dashboard|profiles/);
  });
});

describe("bundled manage-skills skill", () => {
  test("description matches skill management messages", async () => {
    const content = await readBundledSkillMarkdown("manage-skills");
    const parsed = parseSkillMarkdown(content, "manage-skills/SKILL.md");
    const discovered = {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      disableModelInvocation: false,
      includeBodyOnMatch: true,
      directory: "/tmp/manage-skills",
      skillFilePath: "/tmp/manage-skills/SKILL.md",
      body: parsed.body,
      hasTool: false,
      toolPath: null,
    };

    expect(
      matchSkillsForMessage([discovered], "Create a reusable skill for bug triage").map(
        (skill) => skill.name,
      ),
    ).toEqual(["manage-skills"]);
  });
});

describe("bundled archive-profile-memory skill", () => {
  test("description matches archive and cleanup messages", async () => {
    const content = await readBundledSkillMarkdown("archive-profile-memory");
    const parsed = parseSkillMarkdown(content, "archive-profile-memory/SKILL.md");
    const discovered = {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      disableModelInvocation: false,
      includeBodyOnMatch: true,
      directory: "/tmp/archive-profile-memory",
      skillFilePath: "/tmp/archive-profile-memory/SKILL.md",
      body: parsed.body,
      hasTool: false,
      toolPath: null,
    };

    expect(
      matchSkillsForMessage([discovered], "Please forget that preference").map(
        (skill) => skill.name,
      ),
    ).toEqual(["archive-profile-memory"]);

    expect(
      matchSkillsForMessage([discovered], "Clean up old memory from last month").map(
        (skill) => skill.name,
      ),
    ).toEqual(["archive-profile-memory"]);
  });
});

describe("bundled update-profile-memory skill", () => {
  test("description matches remember and preference messages", async () => {
    const content = await readBundledSkillMarkdown("update-profile-memory");
    const parsed = parseSkillMarkdown(content, "update-profile-memory/SKILL.md");
    const discovered = {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      disableModelInvocation: false,
      includeBodyOnMatch: true,
      directory: "/tmp/update-profile-memory",
      skillFilePath: "/tmp/update-profile-memory/SKILL.md",
      body: parsed.body,
      hasTool: false,
      toolPath: null,
    };

    expect(
      matchSkillsForMessage([discovered], "Remember that I prefer dark mode").map(
        (skill) => skill.name,
      ),
    ).toEqual(["update-profile-memory"]);
  });
});

describe("bundled save-artifact skill", () => {
  test("description matches save and report messages", async () => {
    const content = await readBundledSkillMarkdown("save-artifact");
    const parsed = parseSkillMarkdown(content, "save-artifact/SKILL.md");
    const discovered = {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      disableModelInvocation: false,
      includeBodyOnMatch: true,
      directory: "/tmp/save-artifact",
      skillFilePath: "/tmp/save-artifact/SKILL.md",
      body: parsed.body,
      hasTool: false,
      toolPath: null,
    };

    expect(
      matchSkillsForMessage([discovered], "Save this report for later").map(
        (skill) => skill.name,
      ),
    ).toEqual(["save-artifact"]);

    expect(
      matchSkillsForMessage([discovered], "move it to artifact please").map(
        (skill) => skill.name,
      ),
    ).toEqual(["save-artifact"]);
  });
});

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
  });

  test("does not overwrite existing skill files", async () => {
    const skillPath = join(configDir, "agent", "skills", "create-automation", "SKILL.md");
    await mkdir(join(configDir, "agent", "skills", "create-automation"), { recursive: true });
    await Bun.write(skillPath, "---\nname: create-automation\ndescription: custom\n---\n");

    const created = await ensureBundledSkillFiles();

    expect(created).not.toContain("create-automation");
    expect(await readFile(skillPath, "utf8")).toContain("description: custom");
  });
});
