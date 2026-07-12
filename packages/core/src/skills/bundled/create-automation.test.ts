import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchSkillsForMessage } from "../match";
import { parseSkillMarkdown } from "../parse";
import { readBundledSkillMarkdown } from "./index";
import { ensureBundledSkillFiles } from "./install";

describe("bundled create-automation skill", () => {
  test("parses bundled markdown", async () => {
    const content = await readBundledSkillMarkdown("create-automation");
    const parsed = parseSkillMarkdown(content, "create-automation/SKILL.md");

    expect(parsed.frontmatter.name).toBe("create-automation");
    expect(parsed.frontmatter.includeBodyOnMatch).toBe(true);
    expect(parsed.body).toContain("runAt");
    expect(parsed.body).toContain("Do not add delivery when the user only wants results saved");
  });

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
  test("parses bundled markdown", async () => {
    const content = await readBundledSkillMarkdown("create-profile");
    const parsed = parseSkillMarkdown(content, "create-profile/SKILL.md");

    expect(parsed.frontmatter.name).toBe("create-profile");
    expect(parsed.frontmatter.includeBodyOnMatch).toBe(true);
    expect(parsed.body).toContain("`MEMORY.md` must be empty");
    expect(parsed.body).toContain("available-tools context");
  });

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
});

describe("bundled manage-skills skill", () => {
  test("parses bundled markdown", async () => {
    const content = await readBundledSkillMarkdown("manage-skills");
    const parsed = parseSkillMarkdown(content, "manage-skills/SKILL.md");

    expect(parsed.frontmatter.name).toBe("manage-skills");
    expect(parsed.frontmatter.includeBodyOnMatch).toBe(true);
    expect(parsed.body).toContain("write_file");
    expect(parsed.body).toContain("edit_file");
    expect(parsed.body).toContain("skills/{skill-name}/SKILL.md");
  });

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
  test("parses bundled markdown", async () => {
    const content = await readBundledSkillMarkdown("archive-profile-memory");
    const parsed = parseSkillMarkdown(content, "archive-profile-memory/SKILL.md");

    expect(parsed.frontmatter.name).toBe("archive-profile-memory");
    expect(parsed.frontmatter.includeBodyOnMatch).toBe(true);
    expect(parsed.body).toContain("read_file");
    expect(parsed.body).toContain("edit_file");
    expect(parsed.body).toContain("write_file");
    expect(parsed.body).toContain("memory-archive/");
  });

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
  test("parses bundled markdown", async () => {
    const content = await readBundledSkillMarkdown("update-profile-memory");
    const parsed = parseSkillMarkdown(content, "update-profile-memory/SKILL.md");

    expect(parsed.frontmatter.name).toBe("update-profile-memory");
    expect(parsed.frontmatter.includeBodyOnMatch).toBe(true);
    expect(parsed.body).toContain("read_file");
    expect(parsed.body).toContain("edit_file");
    expect(parsed.body).toContain("write_file");
    expect(parsed.body).toContain("MEMORY.md");
    expect(parsed.body).toContain("4096");
  });

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
  test("parses bundled markdown", async () => {
    const content = await readBundledSkillMarkdown("save-artifact");
    const parsed = parseSkillMarkdown(content, "save-artifact/SKILL.md");

    expect(parsed.frontmatter.name).toBe("save-artifact");
    expect(parsed.frontmatter.includeBodyOnMatch).toBe(true);
    expect(parsed.body).toContain("write_file");
    expect(parsed.body).toContain("artifacts/");
    expect(parsed.body).toContain(".nakama-meta.json");
    expect(parsed.body).toContain("mimeType");
  });

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
    expect(created).toContain("coding-delegation");
    expect(created).toContain("coding-backend-codex");
    expect(created).toContain("coding-backend-claude-code");
    expect(created).toContain("coding-backend-opencode");

    const content = await readFile(
      join(configDir, "agent", "skills", "create-automation", "SKILL.md"),
      "utf8",
    );

    expect(content).toContain("name: create-automation");

    const manageSkillsContent = await readFile(
      join(configDir, "agent", "skills", "manage-skills", "SKILL.md"),
      "utf8",
    );

    expect(manageSkillsContent).toContain("name: manage-skills");

    const archiveProfileMemoryContent = await readFile(
      join(configDir, "agent", "skills", "archive-profile-memory", "SKILL.md"),
      "utf8",
    );

    expect(archiveProfileMemoryContent).toContain("name: archive-profile-memory");

    const updateProfileMemoryContent = await readFile(
      join(configDir, "agent", "skills", "update-profile-memory", "SKILL.md"),
      "utf8",
    );

    expect(updateProfileMemoryContent).toContain("name: update-profile-memory");

    const saveArtifactContent = await readFile(
      join(configDir, "agent", "skills", "save-artifact", "SKILL.md"),
      "utf8",
    );

    expect(saveArtifactContent).toContain("name: save-artifact");

    const createProfileContent = await readFile(
      join(configDir, "agent", "skills", "create-profile", "SKILL.md"),
      "utf8",
    );

    expect(createProfileContent).toContain("name: create-profile");

    const codingDelegationContent = await readFile(
      join(configDir, "agent", "skills", "coding-delegation", "SKILL.md"),
      "utf8",
    );

    expect(codingDelegationContent).toContain("name: coding-delegation");
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
