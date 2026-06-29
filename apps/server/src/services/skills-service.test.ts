import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { ensureBundledSkillFiles } from "@tinyclaw/core";
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
    configDir = await mkdtemp(join(tmpdir(), "tinyclaw-skills-test-"));
    process.env.TINYCLAW_CONFIG_DIR = configDir;

    const weatherDir = join(configDir, "agent", "skills", "weather");
    await mkdir(weatherDir, { recursive: true });
    await writeFile(join(weatherDir, "SKILL.md"), weatherSkillMarkdown);
    await writeFile(join(weatherDir, "tool.ts"), "export default {};");
  });

  afterEach(() => {
    delete process.env.TINYCLAW_CONFIG_DIR;
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
});
