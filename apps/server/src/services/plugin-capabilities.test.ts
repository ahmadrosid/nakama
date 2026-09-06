import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  derivePluginToolName,
  getOrgPluginDataDir,
  loadSkillTool,
  PLUGIN_MANIFEST_API_VERSION,
} from "@nakama/core";
import {
  createInMemoryDatabaseAdapter,
  seedOrgDefaultProfile,
} from "@nakama/db";
import { zipSync } from "fflate";
import { PluginInvocationError, PluginService } from "./plugin-service";
import { SkillCuratorService } from "./skill-curator-service";
import { SkillsService } from "./skills-service";
import { resolveProfileStoredTools } from "./tool-resolver";

const ORG_ID = "org_u5";
const OTHER_PROFILE = "profile_unassigned";
const ACTOR = { id: "user_1", role: "member" as const };

const ACTION_JS = `
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export async function run(_input, context) {
  writeFileSync(join(context.dataDir, "spawned"), "1");
  return {
    actor: context.actor,
    orgId: context.orgId,
    profileId: context.profileId ?? null,
  };
}
`;

const SKILL_MD = `---
name: notes
description: Capture notes. Use when the user asks about notes.
---

Store notes in the plugin database.
`;

const SKILL_TOOL_JS = `
import { writeFileSync } from "node:fs";
writeFileSync("/tmp/nakama-plugin-skill-imported", "imported");
export async function run() { return { leaked: true }; }
`;

function encodeZip(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) {
    entries[name] = Buffer.from(value);
  }
  return zipSync(entries);
}

function manifest(
  version: string,
  extras: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    actions: [
      {
        access: "member",
        description: "Write a note",
        effect: "write",
        entry: "actions/write.js",
        exposeAsTool: true,
        inputSchema: { type: "object" },
        key: "write",
      },
    ],
    apiVersion: PLUGIN_MANIFEST_API_VERSION,
    author: "Nakama",
    description: "Notes plugin",
    id: "notes",
    license: "MIT",
    minNakamaVersion: "0.1.0",
    name: "Notes",
    skills: [{ directory: "skills/notes", key: "notes" }],
    version,
    ...extras,
  };
}

function v1Bundle(): Uint8Array {
  return encodeZip({
    "actions/write.js": ACTION_JS,
    "nakama.plugin.json": JSON.stringify(manifest("1.0.0")),
    "skills/notes/SKILL.md": SKILL_MD,
    "skills/notes/tool.js": SKILL_TOOL_JS,
  });
}

function v2BundleWithoutWrite(): Uint8Array {
  return encodeZip({
    "actions/write.js": ACTION_JS,
    "nakama.plugin.json": JSON.stringify(
      manifest("1.1.0", {
        actions: [
          {
            access: "member",
            description: "List notes",
            effect: "read",
            entry: "actions/write.js",
            exposeAsTool: true,
            inputSchema: { type: "object" },
            key: "list",
          },
        ],
        skills: [{ directory: "skills/notes", key: "notes" }],
      })
    ),
    "skills/notes/SKILL.md": SKILL_MD,
    "skills/notes/tool.js": SKILL_TOOL_JS,
  });
}

describe("plugin capabilities", () => {
  let configDir = "";
  const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-plugin-u5-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }
    await rm(configDir, { force: true, recursive: true });
  });

  test("AE1: assigned plugin skill enters the prompt and its tool reaches the dispatcher", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrgDefaultProfile(db, ORG_ID);
    await db.upsertProfile({
      createdAt: profile.createdAt,
      id: OTHER_PROFILE,
      isDefault: false,
      isSuper: false,
      model: null,
      name: "Other",
      orgId: ORG_ID,
      systemPrompt: "",
      updatedAt: profile.updatedAt,
    });

    const plugins = new PluginService(db, configDir);
    const skills = new SkillsService(db);
    skills.setPluginService(plugins);

    await plugins.installPluginPackage(v1Bundle());
    const added = await plugins.addOrgPlugin(ORG_ID, "notes");
    await plugins.enableOrgPlugin(ORG_ID, "notes", added.revision, ACTOR);

    const skill = (await db.listSkills()).find(
      (row) => row.pluginId === "notes"
    );
    const tool = (await db.listTools()).find((row) => row.pluginId === "notes");
    expect(skill).toBeDefined();
    expect(tool).toBeDefined();
    await db.assignSkillToProfile(profile.id, skill!.id);
    await db.assignToolToProfile(profile.id, tool!.id);

    const catalog = await skills.composeCatalogForProfile(ORG_ID, profile.id);
    expect(catalog).toContain("notes");
    expect(catalog).toContain("**notes**");

    const matched = await skills.formatMatchedSkillsForPrompt(
      ORG_ID,
      profile.id,
      "/skill notes"
    );
    expect(matched).toContain("notes");

    const resolved = await resolveProfileStoredTools(
      await db.listToolsForProfile(profile.id),
      db,
      [],
      { pluginService: plugins }
    );
    const pluginTool = resolved.find(
      (item) => item.name === derivePluginToolName("notes", "write")
    );
    expect(pluginTool).toBeDefined();

    const result = (await pluginTool!.run(
      {},
      {
        orgId: ORG_ID,
        orgRole: "member",
        profileId: profile.id,
        sessionId: "session_1",
        userId: "user_1",
      }
    )) as { actor: { role: string }; orgId: string };
    expect(result.orgId).toBe(ORG_ID);
    expect(result.actor.role).toBe("member");

    const otherCatalog = await skills.composeCatalogForProfile(
      ORG_ID,
      OTHER_PROFILE
    );
    expect(otherCatalog).not.toContain("**notes**");
    const otherTools = await resolveProfileStoredTools(
      await db.listToolsForProfile(OTHER_PROFILE),
      db,
      [],
      { pluginService: plugins }
    );
    expect(
      otherTools.some(
        (item) => item.name === derivePluginToolName("notes", "write")
      )
    ).toBe(false);
  });

  test("member resolve skips admin-only plugin tools", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrgDefaultProfile(db, ORG_ID);
    const plugins = new PluginService(db, configDir);
    await plugins.installPluginPackage(
      encodeZip({
        "actions/write.js": ACTION_JS,
        "nakama.plugin.json": JSON.stringify(
          manifest("1.0.0", {
            actions: [
              {
                access: "member",
                description: "Write a note",
                effect: "write",
                entry: "actions/write.js",
                exposeAsTool: true,
                inputSchema: { type: "object" },
                key: "write",
              },
              {
                access: "admin",
                description: "Wipe notes",
                effect: "write",
                entry: "actions/write.js",
                exposeAsTool: true,
                inputSchema: { type: "object" },
                key: "wipe",
              },
            ],
          })
        ),
        "skills/notes/SKILL.md": SKILL_MD,
      })
    );
    const added = await plugins.addOrgPlugin(ORG_ID, "notes");
    await plugins.enableOrgPlugin(ORG_ID, "notes", added.revision, ACTOR);
    const tools = (await db.listTools()).filter(
      (row) => row.pluginId === "notes"
    );
    for (const tool of tools) {
      await db.assignToolToProfile(profile.id, tool.id);
    }

    const memberResolved = await resolveProfileStoredTools(
      await db.listToolsForProfile(profile.id),
      db,
      [],
      { actorRole: "member", pluginService: plugins }
    );
    expect(
      memberResolved.some(
        (item) => item.name === derivePluginToolName("notes", "write")
      )
    ).toBe(true);
    expect(
      memberResolved.some(
        (item) => item.name === derivePluginToolName("notes", "wipe")
      )
    ).toBe(false);

    const adminResolved = await resolveProfileStoredTools(
      await db.listToolsForProfile(profile.id),
      db,
      [],
      { actorRole: "admin", pluginService: plugins }
    );
    expect(
      adminResolved.some(
        (item) => item.name === derivePluginToolName("notes", "wipe")
      )
    ).toBe(true);
  });

  test("AE3: disable between resolve and invoke prevents spawn; next resolve drops the tool", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrgDefaultProfile(db, ORG_ID);
    const plugins = new PluginService(db, configDir);
    const skills = new SkillsService(db);
    skills.setPluginService(plugins);

    await plugins.installPluginPackage(v1Bundle());
    const added = await plugins.addOrgPlugin(ORG_ID, "notes");
    const enabled = await plugins.enableOrgPlugin(
      ORG_ID,
      "notes",
      added.revision,
      ACTOR
    );
    const skill = (await db.listSkills()).find(
      (row) => row.pluginId === "notes"
    );
    const tool = (await db.listTools()).find((row) => row.pluginId === "notes");
    await db.assignSkillToProfile(profile.id, skill!.id);
    await db.assignToolToProfile(profile.id, tool!.id);

    const resolved = await resolveProfileStoredTools(
      await db.listToolsForProfile(profile.id),
      db,
      [],
      { pluginService: plugins }
    );
    const pluginTool = resolved.find(
      (item) => item.name === derivePluginToolName("notes", "write")
    );
    expect(pluginTool).toBeDefined();

    await plugins.disableOrgPlugin(ORG_ID, "notes", enabled.revision, ACTOR);

    await expect(
      pluginTool!.run(
        {},
        {
          orgId: ORG_ID,
          orgRole: "member",
          profileId: profile.id,
          userId: "user_1",
        }
      )
    ).rejects.toBeInstanceOf(PluginInvocationError);
    expect(
      existsSync(
        join(getOrgPluginDataDir(ORG_ID, "notes", configDir), "spawned")
      )
    ).toBe(false);

    const afterDisable = await resolveProfileStoredTools(
      await db.listToolsForProfile(profile.id),
      db,
      [],
      { pluginService: plugins }
    );
    expect(
      afterDisable.some(
        (item) => item.name === derivePluginToolName("notes", "write")
      )
    ).toBe(false);
    expect(
      (await db.listToolsForProfile(profile.id)).some(
        (row) => row.id === tool!.id
      )
    ).toBe(true);
    expect(
      (await db.listSkillsForProfile(profile.id)).some(
        (row) => row.id === skill!.id
      )
    ).toBe(true);

    const catalog = await skills.composeCatalogForProfile(ORG_ID, profile.id);
    expect(catalog).not.toContain("**notes**");
  });

  test("re-enable and update preserve retained IDs; removed keys are reported and not callable", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrgDefaultProfile(db, ORG_ID);
    const plugins = new PluginService(db, configDir);

    await plugins.installPluginPackage(v1Bundle());
    const added = await plugins.addOrgPlugin(ORG_ID, "notes");
    const enabled = await plugins.enableOrgPlugin(
      ORG_ID,
      "notes",
      added.revision,
      ACTOR
    );
    const skill = (await db.listSkills()).find(
      (row) => row.pluginId === "notes"
    );
    const tool = (await db.listTools()).find((row) => row.pluginId === "notes");
    await db.assignSkillToProfile(profile.id, skill!.id);
    await db.assignToolToProfile(profile.id, tool!.id);

    const disabled = await plugins.disableOrgPlugin(
      ORG_ID,
      "notes",
      enabled.revision,
      ACTOR
    );
    const reenabled = await plugins.enableOrgPlugin(
      ORG_ID,
      "notes",
      disabled.revision,
      ACTOR
    );
    expect(
      (await db.listSkills()).find((row) => row.pluginId === "notes")?.id
    ).toBe(skill!.id);
    expect(
      (await db.listTools()).find((row) => row.pluginId === "notes")?.id
    ).toBe(tool!.id);
    expect(
      (await db.listSkillsForProfile(profile.id)).some(
        (row) => row.id === skill!.id
      )
    ).toBe(true);

    await plugins.installPluginPackage(v2BundleWithoutWrite());
    const preview = await plugins.previewPluginContributionChanges(
      ORG_ID,
      "notes",
      "1.1.0"
    );
    expect(preview.removedActionKeys).toEqual(["write"]);
    expect(preview.retainedSkillIds).toEqual([skill!.id]);

    const disabledAgain = await plugins.disableOrgPlugin(
      ORG_ID,
      "notes",
      reenabled.revision,
      ACTOR
    );
    await plugins.updateOrgPlugin(
      ORG_ID,
      "notes",
      "1.1.0",
      disabledAgain.revision,
      ACTOR
    );
    const afterUpdate = await db.getOrgPlugin(ORG_ID, "notes");
    await plugins.enableOrgPlugin(
      ORG_ID,
      "notes",
      afterUpdate!.revision,
      ACTOR
    );

    expect(
      (await db.listSkills()).find((row) => row.pluginKey === "notes")?.id
    ).toBe(skill!.id);
    expect(
      (await db.listTools()).some((row) => row.pluginKey === "write")
    ).toBe(false);

    await expect(
      plugins.invokePluginAction({
        access: "tool",
        actionKey: "write",
        actor: ACTOR,
        input: {},
        orgId: ORG_ID,
        pluginId: "notes",
        profileId: profile.id,
      })
    ).rejects.toBeInstanceOf(PluginInvocationError);
  });

  test("generic sync, curator, file edits, and deletes cannot mutate plugin-owned contributions", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrgDefaultProfile(db, ORG_ID);
    const plugins = new PluginService(db, configDir);
    const skills = new SkillsService(db);
    skills.setPluginService(plugins);

    await plugins.installPluginPackage(v1Bundle());
    const added = await plugins.addOrgPlugin(ORG_ID, "notes");
    await plugins.enableOrgPlugin(ORG_ID, "notes", added.revision, ACTOR);
    const skill = (await db.listSkills()).find(
      (row) => row.pluginId === "notes"
    );
    const tool = (await db.listTools()).find((row) => row.pluginId === "notes");
    await db.assignSkillToProfile(profile.id, skill!.id);
    await db.assignToolToProfile(profile.id, tool!.id);

    const standaloneDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      profile.id,
      "skills",
      "notes"
    );
    await mkdir(standaloneDir, { recursive: true });
    await writeFile(
      join(standaloneDir, "SKILL.md"),
      `---
name: notes
description: Standalone notes shadow attempt.
---

Standalone body.
`
    );

    await skills.syncDiscoveredSkills();
    const pluginAfterSync = await db.getSkill(skill!.id);
    expect(pluginAfterSync?.pluginId).toBe("notes");
    expect(pluginAfterSync?.sourcePath).toBe(skill!.sourcePath);

    await expect(
      skills.patchSkill(ORG_ID, skill!.id, { body: "nope" })
    ).rejects.toThrow();
    await expect(skills.deleteSkill(skill!.id)).rejects.toThrow();
    await expect(
      skills.writeAssignedProfileSkillSupportingFile(
        ORG_ID,
        profile.id,
        "notes",
        "extra.md",
        "x"
      )
    ).rejects.toThrow();

    const curator = new SkillCuratorService(db, skills, undefined, {
      generateMarkdown: async () =>
        "---\nname: notes\ndescription: rewritten\n---\n",
    });
    await db.upsertOrganization({
      createdAt: new Date().toISOString(),
      id: ORG_ID,
      name: "Org",
      skillsCuratorConsolidateEnabled: true,
      skillsWriteApproval: false,
      slug: "org-u5",
      updatedAt: new Date().toISOString(),
    });
    await curator.run(ORG_ID, {
      now: new Date("2026-08-15T12:00:00.000Z"),
      trigger: "manual",
    });
    expect((await db.getSkill(skill!.id))?.description).toBe(
      skill!.description
    );

    const { ProfileService } = await import("./profile-service");
    const profiles = new ProfileService(db);
    await expect(profiles.deleteTool(tool!.id)).rejects.toThrow();
    expect(await db.getTool(tool!.id)).not.toBeNull();
  });

  test("standalone skill with the same local name cannot shadow a namespaced plugin skill", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrgDefaultProfile(db, ORG_ID);
    const plugins = new PluginService(db, configDir);
    const skills = new SkillsService(db);
    skills.setPluginService(plugins);

    await plugins.installPluginPackage(v1Bundle());
    const added = await plugins.addOrgPlugin(ORG_ID, "notes");
    await plugins.enableOrgPlugin(ORG_ID, "notes", added.revision, ACTOR);
    const pluginSkill = (await db.listSkills()).find(
      (row) => row.pluginId === "notes"
    );
    await db.assignSkillToProfile(profile.id, pluginSkill!.id);

    const standaloneDir = join(
      configDir,
      "orgs",
      ORG_ID,
      "profiles",
      profile.id,
      "skills",
      "notes"
    );
    await mkdir(standaloneDir, { recursive: true });
    await writeFile(
      join(standaloneDir, "SKILL.md"),
      `---
name: notes
description: Standalone notes shadow attempt.
---

Standalone body.
`
    );
    await skills.syncProfileSkills(ORG_ID, profile.id);
    const standalone = (await db.listSkills()).find(
      (row) => row.name === "notes" && !row.pluginId
    );
    expect(standalone).toBeDefined();
    await db.assignSkillToProfile(profile.id, standalone!.id);

    const catalog = await skills.composeCatalogForProfile(ORG_ID, profile.id);
    expect(catalog).toContain("**notes**");
    expect(catalog).toContain("Standalone notes shadow attempt");

    const matched = await skills.formatMatchedSkillsForPrompt(
      ORG_ID,
      profile.id,
      "/skill notes"
    );
    expect(matched).toContain("Store notes in the plugin database");

    const pluginDir = await plugins.resolveEnabledSkillDirectory(
      ORG_ID,
      "notes",
      "notes"
    );
    expect(pluginDir).toContain(join("notes", "1.0.0", "skills", "notes"));
    const loaded = await loadSkillTool({
      body: "",
      description: "plugin",
      directory: pluginDir!,
      disableModelInvocation: false,
      hasTool: true,
      includeBodyOnMatch: false,
      name: "notes",
      skillFilePath: join(pluginDir!, "SKILL.md"),
      toolPath: join(pluginDir!, "tool.js"),
    });
    const loadedResult = await loaded!.run({}, {});
    expect(loadedResult).toEqual({
      error: "Plugin skill entrypoints cannot be loaded in-process.",
    });
    expect(existsSync("/tmp/nakama-plugin-skill-imported")).toBe(false);
  });

  test("tool invoke uses trusted context actor and org, never Super Bot platform elevation", async () => {
    const db = createInMemoryDatabaseAdapter();
    const profile = await seedOrgDefaultProfile(db, ORG_ID);
    await db.upsertProfile({ ...profile, isSuper: true });
    const plugins = new PluginService(db, configDir);
    await plugins.installPluginPackage(v1Bundle());
    const added = await plugins.addOrgPlugin(ORG_ID, "notes");
    await plugins.enableOrgPlugin(ORG_ID, "notes", added.revision, ACTOR);
    const tool = (await db.listTools()).find((row) => row.pluginId === "notes");
    await db.assignToolToProfile(profile.id, tool!.id);

    const resolved = await resolveProfileStoredTools(
      await db.listToolsForProfile(profile.id),
      db,
      [],
      { pluginService: plugins }
    );
    const pluginTool = resolved.find(
      (item) => item.name === derivePluginToolName("notes", "write")
    );

    const result = (await pluginTool!.run(
      { actor: { id: "root", role: "admin" }, orgId: "spoof-org" },
      {
        isPlatformAdmin: true,
        orgId: ORG_ID,
        orgRole: "member",
        profileId: profile.id,
        userId: "member_1",
      }
    )) as { actor: { id: string; role: string }; orgId: string };

    expect(result.orgId).toBe(ORG_ID);
    expect(result.actor).toEqual({ id: "member_1", role: "member" });
  });
});
