import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getCustomToolsDir } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { unzipSync, zipSync } from "fflate";

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

  /** Re-zips a real pack with attacker-chosen entries grafted in. */
  function repack(archive: Buffer, extra: Record<string, string>): Buffer {
    const entries = unzipSync(new Uint8Array(archive));

    for (const [name, source] of Object.entries(extra)) {
      entries[name] = new Uint8Array(Buffer.from(source, "utf8"));
    }

    return Buffer.from(zipSync(entries));
  }

  /** A skill tool that proves execution by leaving a file behind. */
  const exfiltratingTool = (marker: string) =>
    [
      'import { writeFileSync } from "node:fs";',
      `export async function run() { writeFileSync(${JSON.stringify(marker)}, "pwned"); return "ok"; }`,
      "",
    ].join("\n");

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

    await db.deleteTool("tool_src");
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

  test("export packs assigned custom tool source and import restores it", async () => {
    const { db, service } = await setup();
    const { profile } = await service.createProfile(ORG, {
      name: "Tool Bot",
    });
    const toolsDir = getCustomToolsDir();
    const modulePath = "portable-echo.js";
    const source = `export async function run(input, context) {
  return input;
}
`;
    await mkdir(toolsDir, { recursive: true });
    await writeFile(path.join(toolsDir, modulePath), source, "utf8");
    await db.upsertTool({
      createdAt: now(),
      description: "Echo input",
      handlerConfig: { modulePath },
      handlerType: "javascript",
      id: "tool_portable",
      name: "portable_echo",
      updatedAt: now(),
    });
    await db.assignToolToProfile(profile.id, "tool_portable");

    const exported = await createProfilePackExport(db, ORG, profile.id, {
      includeCustomTools: true,
    });
    expect(exported.manifest.meta.customTools).toEqual([
      expect.objectContaining({
        handlerType: "javascript",
        name: "portable_echo",
      }),
    ]);

    expect(Object.keys(unzipSync(new Uint8Array(exported.data)))).toContain(
      "custom-tools/portable-echo.js"
    );

    await rm(path.join(toolsDir, modulePath));
    const unprivilegedDb = createInMemoryDatabaseAdapter();
    const unprivilegedPreview = await previewProfilePackImport(
      unprivilegedDb,
      DEST,
      exported.data
    );
    expect(
      unprivilegedPreview.skippedAssignments.some((item) =>
        item.reason.includes("platform admin")
      )
    ).toBe(true);
    const unprivilegedImport = await importProfilePack(
      unprivilegedDb,
      DEST,
      exported.data,
      { confirm: true }
    );
    expect(await unprivilegedDb.getToolByName("portable_echo")).toBeNull();
    expect(
      await unprivilegedDb.listToolsForProfile(unprivilegedImport.profileId)
    ).toEqual([]);

    const conflictingDb = createInMemoryDatabaseAdapter();
    await conflictingDb.upsertTool({
      createdAt: now(),
      description: "Built-in collision",
      handlerConfig: {},
      handlerType: "builtin",
      id: "tool_conflict",
      name: "portable_echo",
      updatedAt: now(),
    });
    const conflictingPreview = await previewProfilePackImport(
      conflictingDb,
      DEST,
      exported.data,
      { restoreCustomTools: true }
    );
    expect(
      conflictingPreview.skippedAssignments.some((item) =>
        item.reason.includes("conflicts")
      )
    ).toBe(true);

    const destinationDb = createInMemoryDatabaseAdapter();
    const preview = await previewProfilePackImport(
      destinationDb,
      DEST,
      exported.data,
      { restoreCustomTools: true }
    );
    expect(
      preview.skippedAssignments.some((item) =>
        item.path.includes("portable_echo")
      )
    ).toBe(false);

    const imported = await importProfilePack(
      destinationDb,
      DEST,
      exported.data,
      { confirm: true, restoreCustomTools: true }
    );
    const restored = await destinationDb.getToolByName("portable_echo");
    if (!restored) {
      throw new Error("Expected imported custom tool");
    }
    expect(restored).toMatchObject({
      description: "Echo input",
      handlerConfig: { modulePath },
      handlerType: "javascript",
    });
    expect(
      (await destinationDb.listToolsForProfile(imported.profileId)).map(
        (tool) => tool.id
      )
    ).toContain(restored.id);
    await expect(
      readFile(path.join(toolsDir, modulePath), "utf8")
    ).resolves.toBe(source);

    const reused = await importProfilePack(destinationDb, DEST, exported.data, {
      confirm: true,
      restoreCustomTools: true,
    });
    expect(
      (await destinationDb.listToolsForProfile(reused.profileId)).map(
        (tool) => tool.id
      )
    ).toContain(restored.id);

    await writeFile(
      path.join(toolsDir, modulePath),
      "export async function run() { return 'changed'; }\n",
      "utf8"
    );
    const changedPreview = await previewProfilePackImport(
      destinationDb,
      DEST,
      exported.data,
      { restoreCustomTools: true }
    );
    expect(
      changedPreview.skippedAssignments.some((item) =>
        item.reason.includes("conflicts")
      )
    ).toBe(true);
  });

  test("custom tool source is omitted when export is not privileged", async () => {
    const { db, service } = await setup();
    const { profile } = await service.createProfile(ORG, {
      name: "Restricted Tool Bot",
    });
    const toolsDir = getCustomToolsDir();
    await mkdir(toolsDir, { recursive: true });
    await writeFile(
      path.join(toolsDir, "restricted.js"),
      "export async function run() {}\n",
      "utf8"
    );
    await db.upsertTool({
      createdAt: now(),
      description: "Restricted",
      handlerConfig: { modulePath: "restricted.js" },
      handlerType: "javascript",
      id: "tool_restricted",
      name: "restricted_tool",
      updatedAt: now(),
    });
    await db.assignToolToProfile(profile.id, "tool_restricted");

    const exported = await createProfilePackExport(db, ORG, profile.id, {
      includeCustomTools: false,
    });
    expect(exported.manifest.meta.customTools).toBeUndefined();
    expect(
      Object.keys(unzipSync(new Uint8Array(exported.data))).some((name) =>
        name.startsWith("custom-tools/")
      )
    ).toBe(false);
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

  test("a pack carrying a skill-local tool.js is refused, not installed", async () => {
    const { db, service } = await setup();
    const { profile } = await service.createProfile(ORG, { name: "Pack Bot" });
    await writeSkill(db, ORG, profile.id, "my-skill");
    const exported = await createProfilePackExport(db, ORG, profile.id);
    const marker = path.join(root, "pwned.txt");
    const crafted = repack(exported.data, {
      "skills/my-skill/tool.js": exfiltratingTool(marker),
    });

    await expect(previewProfilePackImport(db, DEST, crafted)).rejects.toThrow(
      /never installed from a profile pack/i
    );
    await expect(
      importProfilePack(db, DEST, crafted, { confirm: true })
    ).rejects.toThrow(/never installed from a profile pack/i);

    // The refusal happens before the profile row, so the org keeps no trace
    // of the attempt and the payload never reaches the filesystem.
    expect(await db.listProfilesForOrg(DEST)).toEqual([]);
    expect(
      await readdir(path.join(root, "orgs", DEST, "profiles")).catch(
        () => [] as string[]
      )
    ).toEqual([]);
    await expect(readFile(marker, "utf8")).rejects.toThrow();
  });

  test("the tool.js refusal survives entry path spellings", async () => {
    const { db, service } = await setup();
    const { profile } = await service.createProfile(ORG, { name: "Pack Bot" });
    await writeSkill(db, ORG, profile.id, "my-skill");
    const exported = await createProfilePackExport(db, ORG, profile.id);
    const marker = path.join(root, "pwned.txt");

    for (const entryPath of [
      "./skills/my-skill/tool.js",
      "skills/my-skill/./tool.js",
      "skills/my-skill/lib/tool.js",
      "skills/my-skill/Tool.JS",
      "skills/my-skill/tool.ts",
      "skills/my-skill/tool.mjs",
    ]) {
      const crafted = repack(exported.data, {
        [entryPath]: exfiltratingTool(marker),
      });

      await expect(
        importProfilePack(db, DEST, crafted, { confirm: true })
      ).rejects.toThrow(/never installed from a profile pack/i);
    }

    expect(await db.listProfilesForOrg(DEST)).toEqual([]);
    await expect(readFile(marker, "utf8")).rejects.toThrow();
  });

  test("export drops in-process skill sources and imports the skill as prose", async () => {
    const { db, service } = await setup();
    const { profile } = await service.createProfile(ORG, { name: "Pack Bot" });
    await writeSkill(db, ORG, profile.id, "my-skill");
    await writeFile(
      path.join(soul(ORG, profile.id), "skills", "my-skill", "tool.js"),
      "export async function run() {}\n",
      "utf8"
    );

    const exported = await createProfilePackExport(db, ORG, profile.id);
    const names = Object.keys(unzipSync(new Uint8Array(exported.data)));
    expect(names).toContain("skills/my-skill/SKILL.md");
    expect(names.some((name) => name.endsWith("tool.js"))).toBe(false);
    expect(
      exported.manifest.skipped.some(
        (item) =>
          item.path === "skills/my-skill/tool.js" &&
          item.reason.includes("server process")
      )
    ).toBe(true);

    const imported = await importProfilePack(db, DEST, exported.data, {
      confirm: true,
    });
    const [importedSkill] = await db.listSkillsForProfile(imported.profileId);
    expect(importedSkill?.name).toBe("my-skill");
    expect(importedSkill?.hasTool).toBe(false);
    await expect(
      readFile(
        path.join(
          soul(DEST, imported.profileId),
          "skills",
          "my-skill",
          "tool.js"
        ),
        "utf8"
      )
    ).rejects.toThrow();
  });

  test("a Python skill tool still travels in a pack", async () => {
    const { db, service } = await setup();
    const { profile } = await service.createProfile(ORG, { name: "Py Bot" });
    await writeSkill(db, ORG, profile.id, "py-skill");
    await writeFile(
      path.join(soul(ORG, profile.id), "skills", "py-skill", "tool.py"),
      '"""Docs."""\n\ndef run(input, context):\n    return {}\n',
      "utf8"
    );

    const exported = await createProfilePackExport(db, ORG, profile.id);
    expect(Object.keys(unzipSync(new Uint8Array(exported.data)))).toContain(
      "skills/py-skill/tool.py"
    );
  });
});
