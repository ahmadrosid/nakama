import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverSkills } from "./discover";
import { resolveSkillDiscoveryDirs } from "./paths";

const ORG_ID = "org_test";

describe("skill paths", () => {
  let configDir: string | undefined;

  afterEach(() => {
    delete process.env.NAKAMA_CONFIG_DIR;
    configDir = undefined;
  });

  test("resolveSkillDiscoveryDirs defaults to ~/.nakama/agent/skills", async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-paths-test-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    await expect(resolveSkillDiscoveryDirs()).resolves.toEqual([
      path.join(configDir, "agent", "skills"),
    ]);
  });

  test("resolveSkillDiscoveryDirs includes profile skills dir", async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-paths-test-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    await expect(
      resolveSkillDiscoveryDirs({ orgId: ORG_ID, profileId: "profile_default" }),
    ).resolves.toEqual([
      path.join(configDir, "agent", "skills"),
      path.join(configDir, "orgs", ORG_ID, "profiles", "profile_default", "skills"),
    ]);
  });

  test("resolveSkillDiscoveryDirs does not scan every profile when profileId is omitted", async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-paths-test-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    await mkdir(path.join(configDir, "orgs", ORG_ID, "profiles", "profile_a", "skills"), {
      recursive: true,
    });
    await mkdir(path.join(configDir, "orgs", ORG_ID, "profiles", "profile_b", "skills"), {
      recursive: true,
    });

    await expect(resolveSkillDiscoveryDirs()).resolves.toEqual([
      path.join(configDir, "agent", "skills"),
    ]);
  });
});

describe("discoverSkills", () => {
  let configDir: string;

  afterEach(() => {
    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("deduplicates by skill name and prefers the global copy", async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-skill-discover-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const skillMarkdown = `---
name: coding-backend-claude-code
description: Runtime prompt layer for Claude Code delegated coding runs.
disable-model-invocation: true
---

Use Claude Code guidance.
`;

    const globalDir = path.join(configDir, "agent", "skills", "coding-backend-claude-code");
    const profileDir = path.join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      "profile_default",
      "skills",
      "coding-backend-claude-code",
    );

    await mkdir(globalDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    await writeFile(path.join(globalDir, "SKILL.md"), skillMarkdown);
    await writeFile(path.join(profileDir, "SKILL.md"), skillMarkdown);

    const discovered = await discoverSkills({ orgId: ORG_ID, profileId: "profile_default" });

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.name).toBe("coding-backend-claude-code");
    expect(discovered[0]?.directory).toBe(globalDir);
  });
});
