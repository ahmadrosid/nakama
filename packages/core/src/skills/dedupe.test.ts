import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dedupeSkillsByName, isGlobalSkillSourcePath } from "./dedupe";
import { getGlobalSkillsDir, getProfileSkillsDir } from "./paths";

const ORG_ID = "org_test";
const PROFILE_ID = "profile_default";

describe("dedupeSkillsByName", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-dedupe-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("keeps the global copy when the same skill name exists in multiple directories", () => {
    const globalPath = join(getGlobalSkillsDir(), "coding-backend-claude-code");
    const profilePath = join(
      getProfileSkillsDir(ORG_ID, PROFILE_ID),
      "coding-backend-claude-code",
    );

    const deduped = dedupeSkillsByName([
      {
        name: "coding-backend-claude-code",
        sourcePath: profilePath,
        id: "skill_profile_copy",
      },
      {
        name: "coding-backend-claude-code",
        sourcePath: globalPath,
        id: "skill_global_copy",
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.id).toBe("skill_global_copy");
    expect(deduped[0]?.sourcePath).toBe(globalPath);
  });
});

describe("isGlobalSkillSourcePath", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-dedupe-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("detects global and profile skill directories", () => {
    expect(
      isGlobalSkillSourcePath(join(getGlobalSkillsDir(), "coding-backend-claude-code")),
    ).toBe(true);
    expect(
      isGlobalSkillSourcePath(
        join(getProfileSkillsDir(ORG_ID, PROFILE_ID), "coding-backend-claude-code"),
      ),
    ).toBe(false);
  });
});
