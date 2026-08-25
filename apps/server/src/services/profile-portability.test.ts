import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { previewNakamaDataImport } from "./data-portability";
import {
  createProfilePackExport,
  importProfilePack,
  PROFILE_PACK_KIND,
  previewProfilePackImport,
} from "./profile-portability";
import { ProfileService } from "./profile-service";

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
const ORG_ID = "org_test";
const DEST_ORG_ID = "org_dest";

describe("profile portability", () => {
  let tempConfigDir = "";

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }

    if (tempConfigDir) {
      await rm(tempConfigDir, { force: true, recursive: true });
      tempConfigDir = "";
    }
  });

  async function setup() {
    tempConfigDir = await mkdtemp(
      path.join(os.tmpdir(), "nakama-profile-pack-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    const db = createInMemoryDatabaseAdapter();
    const service = new ProfileService(db);
    return { db, service };
  }

  const soulDirOf = (orgId: string, profileId: string) =>
    path.join(tempConfigDir, "orgs", orgId, "profiles", profileId);

  test("export has the profile pack kind, includes soul files, and excludes config/DB/MCP blobs", async () => {
    const { db, service } = await setup();
    const created = await service.createProfile(ORG_ID, {
      name: "Research Bot",
      systemPrompt: "You research things.",
    });
    const profileId = created.profile.id;
    const soulDir = soulDirOf(ORG_ID, profileId);
    await writeFile(
      path.join(soulDir, "MEMORY.md"),
      "- remembers stuff\n",
      "utf8"
    );

    await db.upsertMcpServer({
      cachedTools: [],
      config: { command: "echo", env: { SECRET: "shh" } },
      createdAt: new Date().toISOString(),
      enabled: true,
      id: "mcp_1",
      lastError: null,
      name: "Echo",
      orgId: ORG_ID,
      status: "disconnected",
      transport: "stdio",
      updatedAt: new Date().toISOString(),
    });
    await db.assignMcpServerToProfile(profileId, "mcp_1");

    const result = await createProfilePackExport(db, ORG_ID, profileId);

    expect(result.manifest.kind).toBe(PROFILE_PACK_KIND);
    expect(result.manifest.meta.name).toBe("Research Bot");
    expect(result.manifest.meta.mcpServerNames).toEqual(["Echo"]);
    expect(result.manifest.topLevelPaths).toContain("MEMORY.md");
    expect(result.manifest.topLevelPaths).toContain("SOUL.md");

    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(result.data));
    const entryNames = Object.keys(entries);

    expect(entryNames).not.toContain("config.ini");
    expect(entryNames).not.toContain("nakama.db");
    for (const name of entryNames) {
      expect(name.toLowerCase()).not.toContain("mcp");
    }

    const bodyText = new TextDecoder().decode(entries["MEMORY.md"]);
    expect(bodyText).toContain("remembers stuff");
  });

  test("preview then import creates a new profile and resolves assignments by name", async () => {
    const { db, service } = await setup();
    const created = await service.createProfile(ORG_ID, {
      model: "anthropic:claude-sonnet-4-6",
      name: "Support Bot",
      systemPrompt: "You help customers.",
    });
    const profileId = created.profile.id;

    await db.upsertTool({
      createdAt: new Date().toISOString(),
      description: "Custom tool",
      handlerConfig: {},
      handlerType: "javascript",
      id: "tool_custom",
      name: "custom_tool",
      updatedAt: new Date().toISOString(),
    });
    await db.assignToolToProfile(profileId, "tool_custom");

    const exported = await createProfilePackExport(db, ORG_ID, profileId);

    // Destination org already has a tool with the same name; assignment should resolve.
    await db.upsertTool({
      createdAt: new Date().toISOString(),
      description: "Custom tool",
      handlerConfig: {},
      handlerType: "javascript",
      id: "tool_custom_dest",
      name: "custom_tool",
      updatedAt: new Date().toISOString(),
    });

    const preview = await previewProfilePackImport(
      db,
      DEST_ORG_ID,
      exported.data
    );
    expect(preview.manifest.kind).toBe(PROFILE_PACK_KIND);
    expect(preview.plannedName).toBe("Support Bot");
    expect(preview.resolvedAssignments.toolNames).toContain("custom_tool");

    const countBefore = (await db.listProfilesForOrg(DEST_ORG_ID)).length;

    const imported = await importProfilePack(db, DEST_ORG_ID, exported.data, {
      confirm: true,
    });

    expect(imported.profileId).not.toBe(profileId);
    expect((await db.listProfilesForOrg(DEST_ORG_ID)).length).toBe(
      countBefore + 1
    );

    const importedProfile = await db.getProfileForOrg(
      imported.profileId,
      DEST_ORG_ID
    );
    expect(importedProfile?.name).toBe("Support Bot");
    expect(importedProfile?.model).toBe("anthropic:claude-sonnet-4-6");
    expect(importedProfile?.isSuper).toBe(false);

    const importedTools = await db.listToolsForProfile(imported.profileId);
    expect(importedTools.map((tool) => tool.id)).toContain("tool_custom_dest");

    // The source profile is left completely untouched.
    const source = await db.getProfileForOrg(profileId, ORG_ID);
    expect(source?.name).toBe("Support Bot");
  });

  test("missing MCP/tool name on destination is skipped but the profile is still created", async () => {
    const { db, service } = await setup();
    const created = await service.createProfile(ORG_ID, { name: "Lonely Bot" });
    const profileId = created.profile.id;

    await db.upsertMcpServer({
      cachedTools: [],
      config: { command: "echo" },
      createdAt: new Date().toISOString(),
      enabled: true,
      id: "mcp_missing",
      lastError: null,
      name: "MissingServer",
      orgId: ORG_ID,
      status: "disconnected",
      transport: "stdio",
      updatedAt: new Date().toISOString(),
    });
    await db.assignMcpServerToProfile(profileId, "mcp_missing");

    const exported = await createProfilePackExport(db, ORG_ID, profileId);

    // A fresh destination (different instance/org) has no matching MCP server.
    const destDb = createInMemoryDatabaseAdapter();
    const imported = await importProfilePack(
      destDb,
      DEST_ORG_ID,
      exported.data,
      { confirm: true }
    );

    expect(imported.profileId).toBeTruthy();
    expect(
      imported.skippedAssignments.some(
        (item) =>
          item.path.includes("MissingServer") ||
          item.reason.includes("MissingServer")
      )
    ).toBe(true);
    expect(await destDb.listMcpServersForProfile(imported.profileId)).toEqual(
      []
    );
  });

  test("rejects exporting Super Bot", async () => {
    const { db, service } = await setup();
    const superBot = await service.createProfile(ORG_ID, {
      isSuper: true,
      name: "Super Bot",
    });

    await expect(
      createProfilePackExport(db, ORG_ID, superBot.profile.id)
    ).rejects.toThrow(/super bot cannot be exported/i);
  });

  test("rejects wrong kind on pack preview, and full-root preview rejects a profile pack", async () => {
    const { db, service } = await setup();
    const created = await service.createProfile(ORG_ID, { name: "Bot" });
    const exported = await createProfilePackExport(
      db,
      ORG_ID,
      created.profile.id
    );

    await expect(
      previewNakamaDataImport(exported.data, { rootDir: tempConfigDir })
    ).rejects.toThrow(/missing nakama export manifest/i);

    const { createNakamaDataExport } = await import("./data-portability");
    const fullExport = await createNakamaDataExport({ rootDir: tempConfigDir });

    await expect(
      previewProfilePackImport(db, DEST_ORG_ID, fullExport.data)
    ).rejects.toThrow(/missing the nakama profile pack manifest/i);
  });

  test("preview does not mutate anything", async () => {
    const { db, service } = await setup();
    const created = await service.createProfile(ORG_ID, { name: "Bot" });
    const exported = await createProfilePackExport(
      db,
      ORG_ID,
      created.profile.id
    );

    const countBefore = (await db.listProfilesForOrg(DEST_ORG_ID)).length;
    await previewProfilePackImport(db, DEST_ORG_ID, exported.data);
    expect((await db.listProfilesForOrg(DEST_ORG_ID)).length).toBe(countBefore);
  });

  test("import requires explicit confirmation", async () => {
    const { db, service } = await setup();
    const created = await service.createProfile(ORG_ID, { name: "Bot" });
    const exported = await createProfilePackExport(
      db,
      ORG_ID,
      created.profile.id
    );

    await expect(
      importProfilePack(db, DEST_ORG_ID, exported.data, { confirm: false })
    ).rejects.toThrow(/confirmation is required/i);
  });

  test("round-trips MEMORY.md and knowledge-base while omitting artifacts", async () => {
    const { db, service } = await setup();
    const created = await service.createProfile(ORG_ID, { name: "KB Bot" });
    const profileId = created.profile.id;
    const soulDir = soulDirOf(ORG_ID, profileId);

    await writeFile(
      path.join(soulDir, "MEMORY.md"),
      "- important fact\n",
      "utf8"
    );

    const kbDir = path.join(soulDir, "knowledge-base");
    await mkdir(kbDir, { recursive: true });
    await writeFile(path.join(kbDir, "doc_1--notes.txt"), "kb body", "utf8");

    const artifactsDir = path.join(soulDir, "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(
      path.join(artifactsDir, "report.txt"),
      "generated report",
      "utf8"
    );

    const exported = await createProfilePackExport(db, ORG_ID, profileId);

    expect(
      exported.manifest.skipped.some((item) => item.path === "artifacts")
    ).toBe(true);

    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(exported.data));
    expect(Object.keys(entries)).not.toContain("artifacts/report.txt");

    const imported = await importProfilePack(db, DEST_ORG_ID, exported.data, {
      confirm: true,
    });
    const importedSoulDir = soulDirOf(DEST_ORG_ID, imported.profileId);

    await expect(
      readFile(path.join(importedSoulDir, "MEMORY.md"), "utf8")
    ).resolves.toContain("important fact");
    await expect(
      readFile(
        path.join(importedSoulDir, "knowledge-base", "doc_1--notes.txt"),
        "utf8"
      )
    ).resolves.toBe("kb body");
    await expect(
      readFile(path.join(importedSoulDir, "artifacts", "report.txt"), "utf8")
    ).rejects.toThrow();

    // Source profile untouched.
    await expect(
      readFile(path.join(soulDir, "artifacts", "report.txt"), "utf8")
    ).resolves.toBe("generated report");
  });

  test("assigns a packed profile skill on import and skips name collisions", async () => {
    const { db, service } = await setup();
    const created = await service.createProfile(ORG_ID, { name: "Skill Bot" });
    const profileId = created.profile.id;
    const skillDir = path.join(
      soulDirOf(ORG_ID, profileId),
      "skills",
      "my-skill"
    );
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: my-skill\ndescription: Do a thing.\n---\n\nBody.\n",
      "utf8"
    );
    await db.upsertSkill({
      createdAt: new Date().toISOString(),
      createdBy: "human",
      description: "Do a thing.",
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id: "skill_my_skill",
      name: "my-skill",
      orgId: ORG_ID,
      sourcePath: skillDir,
      updatedAt: new Date().toISOString(),
    });
    await db.assignSkillToProfile(profileId, "skill_my_skill");

    const exported = await createProfilePackExport(db, ORG_ID, profileId);
    const imported = await importProfilePack(db, DEST_ORG_ID, exported.data, {
      confirm: true,
    });

    const importedSkills = await db.listSkillsForProfile(imported.profileId);
    expect(importedSkills.map((skill) => skill.name)).toContain("my-skill");

    // Importing the same pack again should skip on name collision, not throw.
    const secondImport = await importProfilePack(
      db,
      DEST_ORG_ID,
      exported.data,
      { confirm: true }
    );
    expect(
      secondImport.skippedAssignments.some((item) =>
        item.reason.includes("my-skill")
      )
    ).toBe(true);
  });

  test("failed import deletes skills created during that attempt", async () => {
    const { db, service } = await setup();
    const created = await service.createProfile(ORG_ID, {
      name: "Rollback Bot",
    });
    const profileId = created.profile.id;
    const skillDir = path.join(
      soulDirOf(ORG_ID, profileId),
      "skills",
      "rollback-skill"
    );
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: rollback-skill\ndescription: Temporary.\n---\n\nBody.\n",
      "utf8"
    );
    await db.upsertSkill({
      createdAt: new Date().toISOString(),
      createdBy: "human",
      description: "Temporary.",
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id: "skill_rollback",
      name: "rollback-skill",
      orgId: ORG_ID,
      sourcePath: skillDir,
      updatedAt: new Date().toISOString(),
    });
    await db.assignSkillToProfile(profileId, "skill_rollback");
    await db.upsertTool({
      createdAt: new Date().toISOString(),
      description: "Boom",
      enabled: true,
      id: "tool_boom",
      name: "boom-tool",
      orgId: null,
      parameters: { properties: {}, type: "object" },
      source: "builtin",
      updatedAt: new Date().toISOString(),
    });
    await db.assignToolToProfile(profileId, "tool_boom");

    const exported = await createProfilePackExport(db, ORG_ID, profileId);
    const assignTool = db.assignToolToProfile.bind(db);
    db.assignToolToProfile = async () => {
      throw new Error("forced assignment failure");
    };

    await expect(
      importProfilePack(db, DEST_ORG_ID, exported.data, { confirm: true })
    ).rejects.toThrow("forced assignment failure");

    db.assignToolToProfile = assignTool;

    expect(await db.getSkillByName("rollback-skill", DEST_ORG_ID)).toBeNull();
    expect(
      (await db.listProfilesForOrg(DEST_ORG_ID)).some((profile) =>
        profile.name.includes("Rollback")
      )
    ).toBe(false);
  });

  test("excludes archived skills from the export", async () => {
    const { db, service } = await setup();
    const created = await service.createProfile(ORG_ID, { name: "Bot" });
    const profileId = created.profile.id;
    const archiveDir = path.join(
      soulDirOf(ORG_ID, profileId),
      "skills",
      ".archive",
      "old-skill"
    );
    await mkdir(archiveDir, { recursive: true });
    await writeFile(
      path.join(archiveDir, "SKILL.md"),
      "---\nname: old-skill\ndescription: Retired.\n---\n",
      "utf8"
    );

    const exported = await createProfilePackExport(db, ORG_ID, profileId);
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(exported.data));

    expect(Object.keys(entries).some((name) => name.includes(".archive"))).toBe(
      false
    );
    expect(
      exported.manifest.skipped.some((item) =>
        item.path.includes("skills/.archive")
      )
    ).toBe(true);
  });
});
