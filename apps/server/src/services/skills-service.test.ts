import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureBundledSkillFiles } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
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

  test.each([
    [
      "icon.png",
      "image/png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5h8AAAAASUVORK5CYII=",
        "base64"
      ),
    ],
    [
      "icon.svg",
      "image/svg+xml",
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
      ),
    ],
  ])("previews %s as image bytes", async (filename, mediaType, bytes) => {
    const service = new SkillsService(createInMemoryDatabaseAdapter());
    const skill = (await service.listSkills()).skills.find(
      (item) => item.name === "weather"
    )!;
    await writeFile(join(skill.sourcePath, filename), bytes);
    const result = await service.readSkillFile(ORG_ID, skill.id, filename);
    expect(result.image?.mediaType).toBe(mediaType);
    expect(Buffer.from(result.image!.dataBase64, "base64")).toEqual(bytes);
    expect(result.content).toBeNull();
    expect(result.unavailableReason).toBeUndefined();
  });

  test("browses nested skill files without exposing paths outside the skill", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    await service.syncDiscoveredSkills();
    const skill = (await service.listSkills()).skills.find(
      (item) => item.name === "weather"
    )!;
    const directory = join(configDir, "agent", "skills", "weather");
    await mkdir(join(directory, "references", "nested"), { recursive: true });
    await writeFile(
      join(directory, "references", "nested", "guide.md"),
      "# Guide"
    );
    await writeFile(join(directory, "empty.txt"), "");
    await writeFile(join(directory, "image.bin"), Buffer.from([0, 255]));
    await writeFile(join(directory, "large.txt"), "x".repeat(1024 * 1024 + 1));
    const secret = join(configDir, "secret.txt");
    await writeFile(secret, "private");
    await symlink(secret, join(directory, "escape.txt"));

    const listing = await service.listSkillFiles(ORG_ID, skill.id);
    expect(listing.files).toContainEqual({
      path: "references/nested",
      type: "directory",
    });
    expect(listing.files).toContainEqual({
      path: "references/nested/guide.md",
      type: "file",
    });
    expect(listing.files.some((file) => file.path === "escape.txt")).toBe(
      false
    );
    expect(listing.truncated).toBe(false);
    expect(
      (
        await service.readSkillFile(
          ORG_ID,
          skill.id,
          "references/nested/guide.md"
        )
      ).content
    ).toBe("# Guide");
    expect(
      (await service.readSkillFile(ORG_ID, skill.id, "empty.txt")).content
    ).toBe("");
    expect(
      (await service.readSkillFile(ORG_ID, skill.id, "image.bin")).content
    ).toBeNull();
    expect(
      (await service.readSkillFile(ORG_ID, skill.id, "large.txt")).content
    ).toBeNull();
    for (const target of [
      "../secret.txt",
      secret,
      "escape.txt",
      "references",
      "missing.md",
      "",
      "bad\0file",
    ]) {
      await expect(
        service.readSkillFile(ORG_ID, skill.id, target)
      ).rejects.toThrow();
    }
    const record = await db.getSkill(skill.id);
    await db.upsertSkill({ ...record!, orgId: "another_org" });
    await expect(service.listSkillFiles(ORG_ID, skill.id)).rejects.toThrow();
    await expect(
      service.readSkillFile(ORG_ID, skill.id, "SKILL.md")
    ).rejects.toThrow();
  });

  test("matches weather skill instructions for weather questions", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    await service.syncDiscoveredSkills();

    const weather = (await service.listSkills()).skills.find(
      (skill) => skill.name === "weather"
    );

    expect(weather).toBeDefined();

    await db.assignSkillToProfile(PROFILE_ID, weather!.id);

    const matched = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "What's the weather in Jakarta?"
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
      (skill) => skill.name === "weather"
    );

    expect(weather).toBeDefined();

    await db.assignSkillToProfile(PROFILE_ID, weather!.id);

    const matched = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "/skill weather"
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
      (entry) => entry.name === "create-automation"
    );

    expect(skill).toBeDefined();

    await db.assignSkillToProfile(PROFILE_ID, skill!.id);

    const matched = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "Schedule a daily summary at 9am"
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
      (entry) => entry.name === "create-automation"
    );

    expect(skill).toBeDefined();

    await db.assignSkillToProfile(PROFILE_ID, skill!.id);

    const matched = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "Explain how TLS works"
    );

    expect(matched).toBe("");
  });

  test("can append context only for matched skills", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    await ensureBundledSkillFiles();
    await service.syncDiscoveredSkills();

    const skill = (await service.listSkills()).skills.find(
      (entry) => entry.name === "create-profile"
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
      }
    );

    expect(matched).toContain("Active Skill: create-profile");
    expect(matched).toContain("# Available Tools");

    const unrelated = await service.formatMatchedSkillsForPrompt(
      ORG_ID,
      PROFILE_ID,
      "Explain TLS",
      {
        appendContext: () =>
          "# Available Tools\n- read_file\n- write_file\n- edit_file",
      }
    );

    expect(unrelated).toBe("");
  });

  test("creates profile skills and syncs them to the database", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);

    const response = await service.createSkill(ORG_ID, {
      body: "Use this skill when the user asks to save a note.",
      description: "Capture notes for the user.",
      name: "notes",
      profileId: PROFILE_ID,
    });

    expect(response.skill.name).toBe("notes");
    expect(response.skill.sourcePath).toContain(
      join("orgs", ORG_ID, "profiles", PROFILE_ID, "skills", "notes")
    );

    const listed = await service.listSkills();
    expect(listed.skills.some((skill) => skill.name === "notes")).toBe(true);
  });

  test("deletes profile skills from disk and the database", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);

    const created = await service.createSkill(ORG_ID, {
      description: "Capture notes for the user.",
      name: "notes",
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
    const agentBrowser = listed.skills.find(
      (skill) => skill.name === "agent-browser"
    );
    expect(agentBrowser).toBeTruthy();

    await expect(service.deleteSkill(agentBrowser!.id)).rejects.toThrow(
      "Bundled system skills cannot be deleted."
    );
  });

  test("composes always-on agent-browser capability prompt when assigned", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    await ensureBundledSkillFiles();
    await service.syncDiscoveredSkills();

    const agentBrowser = (await service.listSkills()).skills.find(
      (skill) => skill.name === "agent-browser"
    );
    expect(agentBrowser).toBeDefined();

    expect(
      await service.composeAgentBrowserCapabilityForProfile(ORG_ID, PROFILE_ID)
    ).toBe("");

    await db.assignSkillToProfile(PROFILE_ID, agentBrowser!.id);

    const prompt = await service.composeAgentBrowserCapabilityForProfile(
      ORG_ID,
      PROFILE_ID
    );
    expect(prompt).toContain("agent-browser skill");
    expect(prompt).toContain("Available Agent Skills");
    expect(prompt).toContain("Skills are workflow instructions");
    expect(prompt).toContain("/skill agent-browser");
    expect(prompt).toContain("screenshot artifacts/");
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

    const globalDir = join(
      configDir,
      "agent",
      "skills",
      "coding-backend-claude-code"
    );
    const profileDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      "coding-backend-claude-code"
    );

    await mkdir(globalDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(globalDir, "SKILL.md"), skillMarkdown);
    await writeFile(join(profileDir, "SKILL.md"), skillMarkdown);

    await service.syncProfileSkills(ORG_ID, PROFILE_ID);

    const listed = await service.listSkills();
    const matches = listed.skills.filter(
      (skill) => skill.name === "coding-backend-claude-code"
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
      "notes"
    );

    await mkdir(profileDir, { recursive: true });
    await writeFile(
      join(profileDir, "SKILL.md"),
      `---
name: notes
description: Capture notes for the user.
---

Use this skill when the user asks to save a note.
`
    );

    await service.syncProfileSkills(ORG_ID, PROFILE_ID);

    const listed = await service.listSkills();
    const notes = listed.skills.find((skill) => skill.name === "notes");

    expect(notes).toBeDefined();
    expect(notes?.sourcePath).toContain(
      join("orgs", ORG_ID, "profiles", PROFILE_ID, "skills", "notes")
    );
  });

  test("patchSkill updates skill body on disk", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    const profileDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      "notes"
    );

    await mkdir(profileDir, { recursive: true });
    await writeFile(
      join(profileDir, "SKILL.md"),
      `---
name: notes
description: Capture notes for the user.
---

Original body.
`
    );

    await service.syncProfileSkills(ORG_ID, PROFILE_ID);
    const notes = (await service.listSkills()).skills.find(
      (skill) => skill.name === "notes"
    );
    expect(notes).toBeDefined();

    const patched = await service.patchSkill(ORG_ID, notes!.id, {
      body: "Updated body.",
    });

    expect(patched.skill.body).toBe("Updated body.");

    const detail = await service.getSkill(notes!.id);
    expect(detail.skill.body).toBe("Updated body.");
  });

  test("patchSkill keeps the scripts the skill ships", async () => {
    // A patch edits prose. Rewriting the frontmatter without `scripts:` left
    // the skill installed and every one of its scripts unreachable, with
    // nothing on screen saying so, which is how a dashboard edit silently
    // disabled a working skill.
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);
    const profileDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      "beams"
    );

    await mkdir(join(profileDir, "scripts"), { recursive: true });
    await writeFile(
      join(profileDir, "scripts", "beam.py"),
      'def run(input, context):\n    return {}\n\nif __name__ == "__main__":\n' +
        "    import sys, json\n" +
        "    sys.stdout.write(json.dumps(run(json.loads(sys.stdin.read() or '{}'), {})))\n"
    );
    await writeFile(
      join(profileDir, "SKILL.md"),
      `---
name: beams
description: Check a beam.
scripts: scripts/beam.py
---

Original body.
`
    );

    await service.syncProfileSkills(ORG_ID, PROFILE_ID);
    const beams = (await service.listSkills()).skills.find(
      (skill) => skill.name === "beams"
    );
    expect(beams?.hasTool).toBe(true);

    await service.patchSkill(ORG_ID, beams!.id, { body: "Updated body." });

    const onDisk = await readFile(join(profileDir, "SKILL.md"), "utf8");
    expect(onDisk).toContain("scripts: scripts/beam.py");

    const after = (await service.listSkills()).skills.find(
      (skill) => skill.name === "beams"
    );
    expect(after?.hasTool).toBe(true);
  });

  test("editAssignedProfileSkill replaces SKILL.md and refuses rename", async () => {
    const db = createInMemoryDatabaseAdapter();
    const service = new SkillsService(db);

    await service.createAndAssignRawSkillToProfile(
      ORG_ID,
      PROFILE_ID,
      `---
name: deploy
description: Deploy the service.
---

Use staging first.
`
    );

    const edited = await service.editAssignedProfileSkill(
      ORG_ID,
      PROFILE_ID,
      "deploy",
      `---
name: deploy
description: Deploy with canary.
---

Use canary then prod.
`
    );

    expect(edited.skill.description).toBe("Deploy with canary.");
    expect(edited.skill.body).toContain("Use canary then prod.");

    await expect(
      service.editAssignedProfileSkill(
        ORG_ID,
        PROFILE_ID,
        "deploy",
        `---
name: other
description: Renamed.
---

Nope.
`
      )
    ).rejects.toThrow(/must match skill name/i);
  });
});
