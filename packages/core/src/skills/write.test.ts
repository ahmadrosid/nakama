import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathExists } from "../fs";
import { composeSkillMarkdown, createSkillFile, deleteSkillDirectory } from "./write";

const ORG_ID = "org_test";

describe("createSkillFile", () => {
  let configDir: string;

  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;

    if (configDir) {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  test("writes a profile skill to ~/.nakama/orgs/{orgId}/profiles/{id}/skills/", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-write-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const directory = await createSkillFile({
      name: "weather",
      description: "Get weather forecasts. Use when the user asks about weather.",
      body: "Call the weather tool with a city name.",
      orgId: ORG_ID,
      profileId: "profile_default",
    });

    expect(directory).toBe(
      join(configDir, "orgs", ORG_ID, "profiles", "profile_default", "skills", "weather"),
    );

    const content = await readFile(join(directory, "SKILL.md"), "utf8");
    expect(content).toContain("name: weather");
    expect(content).toContain("Call the weather tool");
  });

  test("composeSkillMarkdown includes disable-model-invocation when set", () => {
    const content = composeSkillMarkdown({
      name: "deploy",
      description: "Deploy the app.",
      disableModelInvocation: true,
    });

    expect(content).toContain("disable-model-invocation: true");
  });

  test("deleteSkillDirectory removes a managed profile skill directory", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skill-write-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const directory = await createSkillFile({
      name: "notes",
      description: "Capture notes for the user.",
      orgId: ORG_ID,
      profileId: "profile_default",
    });

    await deleteSkillDirectory(directory);

    expect(await pathExists(directory)).toBe(false);
  });
});
