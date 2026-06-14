import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { ProfileService } from "../services/profile-service";
import { SkillsService } from "../services/skills-service";
import { createCreateSkillTool } from "./create-skill";

const originalConfigDir = process.env.TINYCLAW_CONFIG_DIR;

describe("create_skill tool", () => {
  let tempConfigDir = "";

  beforeEach(async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-create-skill-"));
    process.env.TINYCLAW_CONFIG_DIR = tempConfigDir;
  });

  afterEach(async () => {
    process.env.TINYCLAW_CONFIG_DIR = originalConfigDir;

    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  test("creates and auto-assigns a profile-local skill", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profileService = new ProfileService(db);
    const createdProfile = await profileService.createProfile({ name: "Skill Bot" });
    const skillsService = new SkillsService(db);
    const tool = createCreateSkillTool(skillsService);

    const result = await tool.run(
      {
        name: "notes",
        description: "Capture notes.",
        body: "Use this skill when the user wants to save a note.",
      },
      { profileId: createdProfile.profile.id, sessionId: "session_1" },
    );

    expect(result.skill.name).toBe("notes");
    expect(result.skill.sourcePath).toContain(
      path.join("profiles", createdProfile.profile.id, "skills", "notes"),
    );

    const assigned = await db.listSkillsForProfile(createdProfile.profile.id);
    expect(assigned.map((skill) => skill.name)).toContain("notes");
  });

  test("requires an active profile", async () => {
    const tool = createCreateSkillTool(new SkillsService(createInMemoryDatabaseAdapter()));

    await expect(
      tool.run(
        { name: "notes", description: "Capture notes." },
        { sessionId: "session_1" },
      ),
    ).rejects.toThrow(/active profile session/i);
  });

  test("allows the same skill name in different profiles", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profileService = new ProfileService(db);
    const alpha = await profileService.createProfile({ name: "Alpha" });
    const beta = await profileService.createProfile({ name: "Beta" });
    const tool = createCreateSkillTool(new SkillsService(db));

    const first = await tool.run(
      { name: "notes", description: "Alpha notes." },
      { profileId: alpha.profile.id, sessionId: "session_alpha" },
    );
    const second = await tool.run(
      { name: "notes", description: "Beta notes." },
      { profileId: beta.profile.id, sessionId: "session_beta" },
    );

    expect(first.skill.id).not.toBe(second.skill.id);
    expect(first.skill.sourcePath).not.toBe(second.skill.sourcePath);
    expect((await db.listSkills()).filter((skill) => skill.name === "notes")).toHaveLength(2);
  });
});
