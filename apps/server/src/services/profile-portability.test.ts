import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import {
  createNakamaDataExport,
  previewNakamaDataImport,
} from "./data-portability";
import {
  createProfilePackExport,
  importProfilePack,
  PROFILE_PACK_KIND,
  previewProfilePackImport,
} from "./profile-portability";
import { ProfileService } from "./profile-service";

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
const ORG = "org_test";
const DEST = "org_dest";

describe("profile portability", () => {
  let root = "";

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }
    if (root) {
      await rm(root, { force: true, recursive: true });
      root = "";
    }
  });

  async function setup() {
    root = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-pack-"));
    process.env.NAKAMA_CONFIG_DIR = root;
    const db = createInMemoryDatabaseAdapter();
    return { db, service: new ProfileService(db) };
  }

  const soul = (orgId: string, profileId: string) =>
    path.join(root, "orgs", orgId, "profiles", profileId);

  const now = () => new Date().toISOString();

  async function writeSkill(
    db: ReturnType<typeof createInMemoryDatabaseAdapter>,
    orgId: string,
    profileId: string,
    name: string
  ) {
    const dir = path.join(soul(orgId, profileId), "skills", name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name}.\n---\n\nBody.\n`,
      "utf8"
    );
    const id = `skill_${name}`;
    await db.upsertSkill({
      createdAt: now(),
      createdBy: "human",
      description: `${name}.`,
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id,
      name,
      orgId,
      sourcePath: dir,
      updatedAt: now(),
    });
    await db.assignSkillToProfile(profileId, id);
  }

  test("export packs soul content and skips secrets, artifacts, and archives", async () => {
    const { db, service } = await setup();
    const { profile } = await service.createProfile(ORG, {
      name: "Research Bot",
      systemPrompt: "research",
    });
    const dir = soul(ORG, profile.id);
    await writeFile(path.join(dir, "MEMORY.md"), "- fact\n", "utf8");
    await mkdir(path.join(dir, "knowledge-base"), { recursive: true });
    await writeFile(
      path.join(dir, "knowledge-base", "doc_1--notes.txt"),
      "kb",
      "utf8"
    );
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
    await writeFile(path.join(dir, "artifacts", "report.txt"), "gen", "utf8");
    await mkdir(path.join(dir, "skills", ".archive", "old"), {
      recursive: true,
    });
    await writeFile(
      path.join(dir, "skills", ".archive", "old", "SKILL.md"),
      "---\nname: old\ndescription: x\n---\n",
      "utf8"
    );
    await db.upsertMcpServer({
      cachedTools: [],
      config: { command: "echo", env: { SECRET: "shh" } },
      createdAt: now(),
      enabled: true,
      id: "mcp_1",
      lastError: null,
      name: "Echo",
      orgId: ORG,
      status: "disconnected",
      transport: "stdio",
      updatedAt: now(),
    });
    await db.assignMcpServerToProfile(profile.id, "mcp_1");

    const exported = await createProfilePackExport(db, ORG, profile.id);
    expect(exported.manifest.kind).toBe(PROFILE_PACK_KIND);
    expect(exported.manifest.meta.mcpServerNames).toEqual(["Echo"]);
    expect(exported.manifest.topLevelPaths).toContain("MEMORY.md");
    expect(
      exported.manifest.skipped.some((item) => item.path === "artifacts")
    ).toBe(true);

    const { unzipSync } = await import("fflate");
    const names = Object.keys(unzipSync(new Uint8Array(exported.data)));
    expect(names).toContain("MEMORY.md");
    expect(names).toContain("knowledge-base/doc_1--notes.txt");
    expect(names.some((name) => name.includes("artifacts"))).toBe(false);
    expect(names.some((name) => name.includes(".archive"))).toBe(false);
    expect(names).not.toContain("config.ini");
    expect(names.some((name) => name.toLowerCase().includes("mcp"))).toBe(
      false
    );

    const imported = await importProfilePack(db, DEST, exported.data, {
      confirm: true,
    });
    const dest = soul(DEST, imported.profileId);
    await expect(
      readFile(path.join(dest, "MEMORY.md"), "utf8")
    ).resolves.toContain("fact");
    await expect(
      readFile(path.join(dest, "knowledge-base", "doc_1--notes.txt"), "utf8")
    ).resolves.toBe("kb");
    await expect(
      readFile(path.join(dest, "artifacts", "report.txt"), "utf8")
    ).rejects.toThrow();
  });

  test("import creates a new profile and resolves tools by name", async () => {
    const { db, service } = await setup();
    const { profile } = await service.createProfile(ORG, {
      model: "anthropic:claude-sonnet-4-6",
      name: "Support Bot",
      systemPrompt: "help",
    });
    await db.upsertTool({
      createdAt: now(),
      description: "Custom",
      handlerConfig: {},
      handlerType: "javascript",
      id: "tool_src",
      name: "custom_tool",
      updatedAt: now(),
    });
    await db.assignToolToProfile(profile.id, "tool_src");
    const exported = await createProfilePackExport(db, ORG, profile.id);

    await db.upsertTool({
      createdAt: now(),
      description: "Custom",
      handlerConfig: {},
      handlerType: "javascript",
      id: "tool_dest",
      name: "custom_tool",
      updatedAt: now(),
    });

    const preview = await previewProfilePackImport(db, DEST, exported.data);
    expect(preview.plannedName).toBe("Support Bot");
    expect(
      preview.skippedAssignments.some((s) => s.path.startsWith("tool:"))
    ).toBe(false);

    const before = (await db.listProfilesForOrg(DEST)).length;
    const imported = await importProfilePack(db, DEST, exported.data, {
      confirm: true,
    });
    expect(imported.profileId).not.toBe(profile.id);
    expect(await db.listProfilesForOrg(DEST)).toHaveLength(before + 1);
    expect((await db.getProfileForOrg(imported.profileId, DEST))?.model).toBe(
      "anthropic:claude-sonnet-4-6"
    );
    expect(
      (await db.listToolsForProfile(imported.profileId)).map((t) => t.id)
    ).toContain("tool_dest");
  });

  test("missing destination MCP is skipped; packed skills assign or collide", async () => {
    const { db, service } = await setup();
    const { profile } = await service.createProfile(ORG, { name: "Mixed Bot" });
    await db.upsertMcpServer({
      cachedTools: [],
      config: { command: "echo" },
      createdAt: now(),
      enabled: true,
      id: "mcp_gone",
      lastError: null,
      name: "MissingServer",
      orgId: ORG,
      status: "disconnected",
      transport: "stdio",
      updatedAt: now(),
    });
    await db.assignMcpServerToProfile(profile.id, "mcp_gone");
    await writeSkill(db, ORG, profile.id, "my-skill");

    const exported = await createProfilePackExport(db, ORG, profile.id);

    const destDb = createInMemoryDatabaseAdapter();
    const skippedImport = await importProfilePack(destDb, DEST, exported.data, {
      confirm: true,
    });
    expect(
      skippedImport.skippedAssignments.some((item) =>
        item.path.includes("MissingServer")
      )
    ).toBe(true);
    expect(
      await destDb.listMcpServersForProfile(skippedImport.profileId)
    ).toEqual([]);

    const first = await importProfilePack(db, DEST, exported.data, {
      confirm: true,
    });
    expect(
      (await db.listSkillsForProfile(first.profileId)).map((s) => s.name)
    ).toContain("my-skill");
    const second = await importProfilePack(db, DEST, exported.data, {
      confirm: true,
    });
    expect(
      second.skippedAssignments.some((item) => item.reason.includes("my-skill"))
    ).toBe(true);
  });

  test("guards: Super Bot, confirm, preview-only, and kind mismatch", async () => {
    const { db, service } = await setup();
    const normal = await service.createProfile(ORG, { name: "Bot" });
    const superBot = await service.createProfile(ORG, {
      isSuper: true,
      name: "Super Bot",
    });
    const exported = await createProfilePackExport(db, ORG, normal.profile.id);

    await expect(
      createProfilePackExport(db, ORG, superBot.profile.id)
    ).rejects.toThrow(/super bot cannot be exported/i);
    await expect(
      importProfilePack(db, DEST, exported.data, { confirm: false })
    ).rejects.toThrow(/confirmation is required/i);

    const before = (await db.listProfilesForOrg(DEST)).length;
    await previewProfilePackImport(db, DEST, exported.data);
    expect(await db.listProfilesForOrg(DEST)).toHaveLength(before);

    await expect(
      previewNakamaDataImport(exported.data, { rootDir: root })
    ).rejects.toThrow(/missing nakama export manifest/i);
    const full = await createNakamaDataExport({ rootDir: root });
    await expect(previewProfilePackImport(db, DEST, full.data)).rejects.toThrow(
      /missing the nakama profile pack manifest/i
    );
  });

  test("failed import rolls back created skills and the profile", async () => {
    const { db, service } = await setup();
    const { profile } = await service.createProfile(ORG, {
      name: "Rollback Bot",
    });
    await writeSkill(db, ORG, profile.id, "rollback-skill");
    await db.upsertTool({
      createdAt: now(),
      description: "Boom",
      handlerConfig: {},
      handlerType: "builtin",
      id: "tool_boom",
      name: "boom-tool",
      updatedAt: now(),
    });
    await db.assignToolToProfile(profile.id, "tool_boom");

    const exported = await createProfilePackExport(db, ORG, profile.id);
    const assignTool = db.assignToolToProfile.bind(db);
    db.assignToolToProfile = async () => {
      throw new Error("forced assignment failure");
    };

    await expect(
      importProfilePack(db, DEST, exported.data, { confirm: true })
    ).rejects.toThrow("forced assignment failure");
    db.assignToolToProfile = assignTool;

    expect(await db.getSkillByName("rollback-skill", DEST)).toBeNull();
    expect(
      (await db.listProfilesForOrg(DEST)).some((p) =>
        p.name.includes("Rollback")
      )
    ).toBe(false);
  });
});
