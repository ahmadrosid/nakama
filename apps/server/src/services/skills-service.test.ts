import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { ensureBundledSkillFiles } from "@nakama/core";
import { SkillsService } from "./skills-service";

const ORG_ID = "org_test";
const PROFILE_ID = "profile_default";

const weatherSkillMarkdown = `---
name: weather
description: Get weather forecasts. Use when the user asks about weather.
---

Call the \`weather\` tool with a city name.
`;

describe("SkillsService", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-skills-test-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const weatherDir = join(configDir, "agent", "skills", "weather");
    await mkdir(weatherDir, { recursive: true });
    await writeFile(join(weatherDir, "SKILL.md"), weatherSkillMarkdown);
    await writeFile(join(weatherDir, "tool.ts"), "export default {};");
  });

  afterEach(() => {
    delete process.env.NAKAMA_CONFIG_DIR;
  });

  test("discovers global skills and syncs them to the database", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    const result = await service.syncDiscoveredSkills();

    expect(result.discovered).toBe(1);

    const listed = await service.listSkills();
    const weather = listed.skills.find((skill) => skill.name === "weather");

    expect(weather).toBeDefined();
    expect(weather?.hasTool).toBe(true);
  });

  test("matches weather skill instructions for weather questions", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    await service.syncDiscoveredSkills();

    const weather = (await service.listSkills()).skills.find(
      (skill) => skill.name === "weather",
    );

    expect(weather).toBeDefined();

    await db.assignSkillToProfile(PROFILE_ID, weather!.id);

    const matched = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "What's the weather in Jakarta?",
    );

    expect(matched).toContain("Active Skill: weather");
    expect(matched).toContain("Get weather forecasts");
    expect(matched).not.toContain("Call the `weather` tool");
  });

  test("includes full skill body for explicit skill activation", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    await service.syncDiscoveredSkills();

    const weather = (await service.listSkills()).skills.find(
      (skill) => skill.name === "weather",
    );

    expect(weather).toBeDefined();

    await db.assignSkillToProfile(PROFILE_ID, weather!.id);

    const matched = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "/skill weather",
    );

    expect(matched).toContain("Active Skill: weather");
    expect(matched).toContain("Call the `weather` tool");
  });

  test("includes full body for bundled create-automation matches", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    await ensureBundledSkillFiles();
    await service.syncDiscoveredSkills();

    const skill = (await service.listSkills()).skills.find(
      (entry) => entry.name === "create-automation",
    );

    expect(skill).toBeDefined();

    await db.assignSkillToProfile(PROFILE_ID, skill!.id);

    const matched = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "Schedule a daily summary at 9am",
    );

    expect(matched).toContain("Active Skill: create-automation");
    expect(matched).toContain("runAt");
    expect(matched).toContain("5-field cron syntax");
  });

  test("does not include create-automation body for unrelated messages", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    await ensureBundledSkillFiles();
    await service.syncDiscoveredSkills();

    const skill = (await service.listSkills()).skills.find(
      (entry) => entry.name === "create-automation",
    );

    expect(skill).toBeDefined();

    await db.assignSkillToProfile(PROFILE_ID, skill!.id);

    const matched = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "Explain how TLS works",
    );

    expect(matched).toBe("");
  });

  test("can append context only for matched skills", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    await ensureBundledSkillFiles();
    await service.syncDiscoveredSkills();

    const skill = (await service.listSkills()).skills.find(
      (entry) => entry.name === "create-profile",
    );

    expect(skill).toBeDefined();

    await db.assignSkillToProfile(PROFILE_ID, skill!.id);

    const matched = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "Create a support bot profile",
      {
        appendContext: (skills) =>
          skills.some((entry) => entry.name === "create-profile")
            ? "# Available Tools\n- read_file\n- write_file\n- edit_file"
            : "",
      },
    );

    expect(matched).toContain("Active Skill: create-profile");
    expect(matched).toContain("# Available Tools");

    const unrelated = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "Explain TLS",
      {
        appendContext: () => "# Available Tools\n- read_file\n- write_file\n- edit_file",
      },
    );

    expect(unrelated).toBe("");
  });

  test("creates profile skills and syncs them to the database", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);

    const response = await service.createSkill(ORG_ID, {
      name: "notes",
      description: "Capture notes for the user.",
      body: "Use this skill when the user asks to save a note.",
      profileId: PROFILE_ID,
    });

    expect(response.skill.name).toBe("notes");
    expect(response.skill.sourcePath).toContain(
      join("orgs", ORG_ID, "profiles", PROFILE_ID, "skills", "notes"),
    );

    const listed = await service.listSkills();
    expect(listed.skills.some((skill) => skill.name === "notes")).toBe(true);
  });

  test("deletes profile skills from disk and the database", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);

    const created = await service.createSkill(ORG_ID, {
      name: "notes",
      description: "Capture notes for the user.",
      profileId: PROFILE_ID,
    });

    await service.deleteSkill(created.skill.id);

    const listed = await service.listSkills();
    expect(listed.skills.some((skill) => skill.name === "notes")).toBe(false);
  });

  test("rejects deleting bundled system skills", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    await ensureBundledSkillFiles();
    await service.syncDiscoveredSkills();

    const listed = await service.listSkills();
    const agentBrowser = listed.skills.find((skill) => skill.name === "agent-browser");
    expect(agentBrowser).toBeTruthy();

    await expect(service.deleteSkill(agentBrowser!.id)).rejects.toThrow(
      "Bundled system skills cannot be deleted.",
    );
  });

  test("deduplicates skills discovered from global and profile directories", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    const skillMarkdown = `---
name: coding-backend-claude-code
description: Runtime prompt layer for Claude Code delegated coding runs.
disable-model-invocation: true
---

Use Claude Code guidance.
`;

    const globalDir = join(configDir, "agent", "skills", "coding-backend-claude-code");
    const profileDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      "coding-backend-claude-code",
    );

    await mkdir(globalDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(globalDir, "SKILL.md"), skillMarkdown);
    await writeFile(join(profileDir, "SKILL.md"), skillMarkdown);

    await service.syncProfileSkills(ORG_ID, PROFILE_ID);

    const listed = await service.listSkills();
    const matches = listed.skills.filter(
      (skill) => skill.name === "coding-backend-claude-code",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.sourcePath).toContain(join("agent", "skills"));
  });

  test("syncs profile-scoped skills without scanning every profile directory", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    const profileDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      "notes",
    );

    await mkdir(profileDir, { recursive: true });
    await writeFile(
      join(profileDir, "SKILL.md"),
      `---
name: notes
description: Capture notes for the user.
---

Use this skill when the user asks to save a note.
`,
    );

    await service.syncProfileSkills(ORG_ID, PROFILE_ID);

    const listed = await service.listSkills();
    const notes = listed.skills.find((skill) => skill.name === "notes");

    expect(notes).toBeDefined();
    expect(notes?.sourcePath).toContain(
      join("orgs", ORG_ID, "profiles", PROFILE_ID, "skills", "notes"),
    );
  });
});
