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

describe("ensureBundledSkillFiles", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "tinyclaw-bundled-skills-"));
    process.env.TINYCLAW_CONFIG_DIR = configDir;
    await mkdir(join(configDir, "agent", "skills"), { recursive: true });
  });

  afterEach(() => {
    delete process.env.TINYCLAW_CONFIG_DIR;
  });

  test("writes bundled skills when missing", async () => {
    const created = await ensureBundledSkillFiles();

    expect(created).toContain("create-automation");

    const content = await readFile(
      join(configDir, "agent", "skills", "create-automation", "SKILL.md"),
      "utf8",
    );

    expect(content).toContain("name: create-automation");
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
