import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathExists } from "../fs";
import { archiveSkillDirectory } from "./archive";
import { discoverSkills } from "./discover";
import {
  classifySkillFreshness,
  SKILL_ARCHIVE_AFTER_MS,
  SKILL_STALE_AFTER_MS,
} from "./freshness";
import { SKILL_ARCHIVE_DIR_NAME } from "./paths";

const ORG_ID = "org_test";
const PROFILE_ID = "profile_default";
const DAY_MS = 24 * 60 * 60 * 1000;

describe("classifySkillFreshness", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");

  test("uses lastUsedAt when present", () => {
    expect(
      classifySkillFreshness({
        createdAt: "2025-01-01T00:00:00.000Z",
        lastUsedAt: new Date(now.getTime() - 10 * DAY_MS).toISOString(),
        now,
      })
    ).toBe("active");
  });

  test("falls back to createdAt when never matched", () => {
    expect(
      classifySkillFreshness({
        createdAt: new Date(now.getTime() - 10 * DAY_MS).toISOString(),
        lastUsedAt: null,
        now,
      })
    ).toBe("active");
  });

  test("marks unused at the 30-day threshold as stale", () => {
    expect(
      classifySkillFreshness({
        createdAt: "2025-01-01T00:00:00.000Z",
        lastUsedAt: new Date(
          now.getTime() - SKILL_STALE_AFTER_MS
        ).toISOString(),
        now,
      })
    ).toBe("stale");
  });

  test("uses organization stale and archive day overrides", () => {
    const staleAfterDays = 7;
    const archiveAfterDays = 21;

    expect(
      classifySkillFreshness({
        archiveAfterDays,
        createdAt: "2025-01-01T00:00:00.000Z",
        lastUsedAt: new Date(now.getTime() - 8 * DAY_MS).toISOString(),
        now,
        staleAfterDays,
      })
    ).toBe("stale");

    expect(
      classifySkillFreshness({
        archiveAfterDays,
        createdAt: "2025-01-01T00:00:00.000Z",
        lastUsedAt: new Date(now.getTime() - 22 * DAY_MS).toISOString(),
        now,
        staleAfterDays,
      })
    ).toBe("archive_due");
  });

  test("marks unused at the 90-day threshold as archive_due", () => {
    expect(
      classifySkillFreshness({
        createdAt: "2025-01-01T00:00:00.000Z",
        lastUsedAt: new Date(
          now.getTime() - SKILL_ARCHIVE_AFTER_MS
        ).toISOString(),
        now,
      })
    ).toBe("archive_due");
  });

  test("never-matched skills become archive_due from createdAt age", () => {
    expect(
      classifySkillFreshness({
        createdAt: new Date(now.getTime() - 100 * DAY_MS).toISOString(),
        lastUsedAt: null,
        now,
      })
    ).toBe("archive_due");
  });
});

describe("archiveSkillDirectory", () => {
  let configDir: string;

  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;

    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
    }
  });

  async function writeProfileSkill(
    name: string,
    body = "Keep this."
  ): Promise<string> {
    configDir =
      configDir ??
      (await mkdtemp(path.join(tmpdir(), "nakama-skill-archive-")));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    const directory = path.join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      name
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: Test skill.\n---\n\n${body}\n`
    );
    return directory;
  }

  test("moves a profile skill directory into skills/.archive", async () => {
    const liveDir = await writeProfileSkill("old-playbook", "Still on disk.");

    const result = await archiveSkillDirectory({
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      skillName: "old-playbook",
    });

    expect(await pathExists(liveDir)).toBe(false);
    expect(result.archivedDirectory).toBe(
      path.join(path.dirname(liveDir), SKILL_ARCHIVE_DIR_NAME, "old-playbook")
    );
    expect(
      await pathExists(path.join(result.archivedDirectory, "SKILL.md"))
    ).toBe(true);
    const content = await readFile(
      path.join(result.archivedDirectory, "SKILL.md"),
      "utf8"
    );
    expect(content).toContain("Still on disk.");
  });

  test("uses a timestamp suffix when the archive name already exists", async () => {
    const liveDir = await writeProfileSkill("old-playbook", "Newer copy.");
    const archiveDir = path.join(
      path.dirname(liveDir),
      SKILL_ARCHIVE_DIR_NAME,
      "old-playbook"
    );
    await mkdir(archiveDir, { recursive: true });
    await writeFile(
      path.join(archiveDir, "SKILL.md"),
      "Older archived copy.\n"
    );

    const now = new Date("2026-08-15T12:00:00.000Z");
    const result = await archiveSkillDirectory({
      now,
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      skillName: "old-playbook",
    });

    expect(result.archivedDirectory).toBe(
      path.join(
        path.dirname(liveDir),
        SKILL_ARCHIVE_DIR_NAME,
        `old-playbook-${now.getTime()}`
      )
    );
    expect(await pathExists(liveDir)).toBe(false);
    expect(await readFile(path.join(archiveDir, "SKILL.md"), "utf8")).toBe(
      "Older archived copy.\n"
    );
    expect(
      await readFile(path.join(result.archivedDirectory, "SKILL.md"), "utf8")
    ).toContain("Newer copy.");
  });

  test("refuses bundled skill names without moving files", async () => {
    const liveDir = await writeProfileSkill("manage-skills");

    await expect(
      archiveSkillDirectory({
        orgId: ORG_ID,
        profileId: PROFILE_ID,
        skillName: "manage-skills",
      })
    ).rejects.toThrow();

    expect(await pathExists(liveDir)).toBe(true);
  });

  test("refuses a skill that is already under .archive", async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-skill-archive-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    const archived = path.join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      SKILL_ARCHIVE_DIR_NAME,
      "old-playbook"
    );
    await mkdir(archived, { recursive: true });
    await writeFile(
      path.join(archived, "SKILL.md"),
      "---\nname: old-playbook\ndescription: Archived.\n---\n"
    );

    await expect(
      archiveSkillDirectory({
        orgId: ORG_ID,
        profileId: PROFILE_ID,
        skillName: "old-playbook",
      })
    ).rejects.toThrow();

    expect(await pathExists(archived)).toBe(true);
  });
});

describe("discoverSkills archive skip", () => {
  let configDir: string;

  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;

    if (configDir) {
      await rm(configDir, { force: true, recursive: true });
    }
  });

  test("does not return skills that live under skills/.archive", async () => {
    configDir = await mkdtemp(
      path.join(tmpdir(), "nakama-skill-discover-archive-")
    );
    process.env.NAKAMA_CONFIG_DIR = configDir;

    const liveDir = path.join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      "live-skill"
    );
    const archivedDir = path.join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      PROFILE_ID,
      "skills",
      SKILL_ARCHIVE_DIR_NAME,
      "archived-skill"
    );
    await mkdir(liveDir, { recursive: true });
    await mkdir(archivedDir, { recursive: true });
    await writeFile(
      path.join(liveDir, "SKILL.md"),
      "---\nname: live-skill\ndescription: Live.\n---\n"
    );
    await writeFile(
      path.join(archivedDir, "SKILL.md"),
      "---\nname: archived-skill\ndescription: Archived.\n---\n"
    );

    const discovered = await discoverSkills({
      orgId: ORG_ID,
      profileId: PROFILE_ID,
    });

    expect(discovered.map((skill) => skill.name)).toEqual(["live-skill"]);
  });
});
