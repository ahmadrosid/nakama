import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureBundledSkillFiles } from "./install";

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

  test("force-refreshes coding agent backend skills when installed copies are stale", async () => {
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

    const codexPath = join(
      configDir,
      "agent",
      "skills",
      "coding-backend-codex",
      "SKILL.md"
    );

    await mkdir(join(configDir, "agent", "skills", "coding-agent"), {
      recursive: true,
    });
    await mkdir(join(configDir, "agent", "skills", "coding-backend-cursor"), {
      recursive: true,
    });
    await mkdir(join(configDir, "agent", "skills", "coding-backend-codex"), {
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
    await Bun.write(
      codexPath,
      "---\nname: coding-backend-codex\ndescription: stale\n---\n"
    );

    const created = await ensureBundledSkillFiles();
    const codingAgent = await readFile(codingAgentPath, "utf8");
    const cursor = await readFile(cursorPath, "utf8");
    const codex = await readFile(codexPath, "utf8");

    expect(created).toContain("coding-agent");
    expect(created).toContain("coding-backend-cursor");
    expect(created).toContain("coding-backend-codex");
    expect(codingAgent).toContain("gh pr create");
    expect(codingAgent).not.toContain("description: stale");
    expect(cursor).toContain("Commits and pull requests");
    expect(cursor).toContain("open a PR with gh");
    expect(cursor).not.toContain("description: stale");
    expect(codex).toContain(
      "codex exec --dangerously-bypass-approvals-and-sandbox"
    );
    expect(codex).not.toContain("description: stale");
  });
});
