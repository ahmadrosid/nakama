import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createInMemoryDatabaseAdapter,
  ensureBuiltinToolDefinitions,
} from "@nakama/db";
import { ProfileService } from "./profile-service";

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const ORG_ID = "org_test";

describe("profile service createTool", () => {
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

  test("defaults to an executable javascript tool", async () => {
    tempConfigDir = await mkdtemp(
      path.join(os.tmpdir(), "nakama-profile-tool-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    const toolsDir = path.join(tempConfigDir, "tools");
    await mkdir(toolsDir, { recursive: true });

    await writeFile(
      path.join(toolsDir, "echo.js"),
      `export async function run(input) {
  return input;
}
`,
      "utf8"
    );

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const tool = await service.createTool({
      description: "Echo input",
      handlerConfig: { modulePath: "echo.js" },
      name: "echo",
    });

    expect(tool.handlerType).toBe("javascript");
  });

  test("rejects non-javascript handler types", async () => {
    const service = new ProfileService(createInMemoryDatabaseAdapter());

    await expect(
      service.createTool({
        description: "Bad tool",
        handlerConfig: { modulePath: "bad-tool.js" },
        handlerType: "custom",
        name: "bad-tool",
      })
    ).rejects.toThrow(/only javascript tools can be created/i);
  });
});

describe("profile service avatar", () => {
  let tempConfigDir = "";

  afterEach(async () => {
    process.env.NAKAMA_CONFIG_DIR = originalConfigDir;

    if (tempConfigDir) {
      await rm(tempConfigDir, { force: true, recursive: true });
      tempConfigDir = "";
    }
  });

  test("uploads, serves, and deletes profile avatars", async () => {
    tempConfigDir = await mkdtemp(
      path.join(os.tmpdir(), "nakama-profile-avatar-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile(ORG_ID, { name: "Avatar Bot" });
    const profileId = created.profile.id;

    expect(created.profile.hasAvatar).toBe(false);

    const updated = await service.uploadProfileAvatar(ORG_ID, profileId, {
      data: tinyPngBase64,
      mediaType: "image/png",
    });

    expect(updated.profile.hasAvatar).toBe(true);

    const avatar = await service.getProfileAvatar(ORG_ID, profileId);
    expect(avatar.mediaType).toBe("image/png");
    expect(avatar.bytes.length).toBeGreaterThan(0);

    const publicAvatar = await service.getProfileAvatarByProfileId(profileId);
    expect(publicAvatar.mediaType).toBe("image/png");
    expect(publicAvatar.bytes.length).toBeGreaterThan(0);

    await service.deleteProfileAvatar(ORG_ID, profileId);

    const afterDelete = await service.getProfile(ORG_ID, profileId);
    expect(afterDelete.profile.hasAvatar).toBe(false);
  });
});

describe("profile service createProfile", () => {
  let tempConfigDir = "";

  afterEach(async () => {
    process.env.NAKAMA_CONFIG_DIR = originalConfigDir;

    if (tempConfigDir) {
      await rm(tempConfigDir, { force: true, recursive: true });
      tempConfigDir = "";
    }
  });

  test("scaffolds soul templates for new profiles", async () => {
    tempConfigDir = await mkdtemp(
      path.join(os.tmpdir(), "nakama-profile-soul-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile(ORG_ID, { name: "Soul Bot" });
    const soulDir = path.join(
      tempConfigDir,
      "orgs",
      ORG_ID,
      "profiles",
      created.profile.id
    );
    const soulContent = await readFile(path.join(soulDir, "SOUL.md"), "utf8");

    expect(soulContent.trim().length).toBeGreaterThan(0);
    await expect(
      readFile(path.join(soulDir, "STYLE.md"), "utf8")
    ).resolves.toMatch(/\S/);
  });

  test("assigns basic tools when the built-in tools exist", async () => {
    tempConfigDir = await mkdtemp(
      path.join(os.tmpdir(), "nakama-profile-default-tools-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const db = createInMemoryDatabaseAdapter();
    await ensureBuiltinToolDefinitions(db);

    const service = new ProfileService(db);
    const created = await service.createProfile(ORG_ID, { name: "Skill Bot" });
    const tools = await db.listToolsForProfile(created.profile.id);

    expect(tools.map((tool) => tool.name)).toContain("read_file");
    expect(tools.map((tool) => tool.name)).toContain("write_file");
    expect(tools.map((tool) => tool.name)).toContain("edit_file");
    expect(tools.map((tool) => tool.name)).toContain("search_files");
    expect(tools.map((tool) => tool.name)).toContain("knowledge_base_search");
    expect(tools.map((tool) => tool.name)).toContain("web_fetch");
    expect(tools.map((tool) => tool.name)).not.toContain(
      "update_profile_memory"
    );
    expect(tools.map((tool) => tool.name)).not.toContain("web_search");
  });

  test("assigns default bundled skills when they exist", async () => {
    tempConfigDir = await mkdtemp(
      path.join(os.tmpdir(), "nakama-profile-default-skills-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertSkill({
      createdAt: now,
      createdBy: "bundled",
      description:
        "Create, update, inspect, or manage reusable profile skills.",
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id: "skill_manage_skills",
      name: "manage-skills",
      sourcePath: path.join(tempConfigDir, "agent", "skills", "manage-skills"),
      updatedAt: now,
    });

    const service = new ProfileService(db);
    const created = await service.createProfile(ORG_ID, { name: "Skill Bot" });
    const skills = await db.listSkillsForProfile(created.profile.id);

    expect(skills.map((skill) => skill.name)).toContain("manage-skills");
  });

  test("skips missing basic built-in tools without failing", async () => {
    tempConfigDir = await mkdtemp(
      path.join(os.tmpdir(), "nakama-profile-missing-tools-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const db = createInMemoryDatabaseAdapter();

    const service = new ProfileService(db);
    const created = await service.createProfile(ORG_ID, {
      name: "No Tools Bot",
    });
    const tools = await db.listToolsForProfile(created.profile.id);

    expect(tools).toEqual([]);
  });

  test("writes generated soul files and keeps memory empty", async () => {
    tempConfigDir = await mkdtemp(
      path.join(os.tmpdir(), "nakama-profile-generated-soul-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile(ORG_ID, {
      name: "Support Bot",
      soulFiles: {
        "INSTRUCTIONS.md": "# Instructions\n\nEscalate billing risks.",
        "SOUL.md": "# Support Bot\n\nHelps customers.",
        "STYLE.md": "# Style\n\nClear and kind.",
      },
    });
    const soulDir = path.join(
      tempConfigDir,
      "orgs",
      ORG_ID,
      "profiles",
      created.profile.id
    );

    await expect(
      readFile(path.join(soulDir, "SOUL.md"), "utf8")
    ).resolves.toContain("# Support Bot");
    await expect(
      readFile(path.join(soulDir, "STYLE.md"), "utf8")
    ).resolves.toContain("Clear and kind");
    await expect(
      readFile(path.join(soulDir, "INSTRUCTIONS.md"), "utf8")
    ).resolves.toContain("Escalate billing risks");
    await expect(
      readFile(path.join(soulDir, "MEMORY.md"), "utf8")
    ).resolves.toBe("");
  });

  test("rejects unsupported generated soul file keys", async () => {
    tempConfigDir = await mkdtemp(
      path.join(os.tmpdir(), "nakama-profile-bad-soul-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());

    await expect(
      service.createProfile(ORG_ID, {
        name: "Bad Soul Bot",
        soulFiles: {
          "../SOUL.md": "# Bad",
        } as never,
      })
    ).rejects.toThrow(/unsupported soul file/i);
  });

  test("stores profile model selection", async () => {
    tempConfigDir = await mkdtemp(
      path.join(os.tmpdir(), "nakama-profile-model-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());

    const created = await service.createProfile(ORG_ID, {
      model: "openai:gpt-5",
      name: "Model Bot",
    });

    expect(created.profile.model).toBe("openai:gpt-5");

    const updated = await service.updateProfile(ORG_ID, created.profile.id, {
      model: "anthropic:claude-sonnet-4",
    });

    expect(updated.profile.model).toBe("anthropic:claude-sonnet-4");
  });

  test("uses a slug from the profile name when id is omitted", async () => {
    tempConfigDir = await mkdtemp(
      path.join(os.tmpdir(), "nakama-profile-slug-id-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile(ORG_ID, {
      name: "Research Assistant",
    });

    expect(created.profile.id).toBe("research-assistant");
  });

  test("uses a custom profile id when provided", async () => {
    tempConfigDir = await mkdtemp(
      path.join(os.tmpdir(), "nakama-profile-custom-id-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile(ORG_ID, {
      id: "research-bot",
      name: "Research Bot",
    });

    expect(created.profile.id).toBe("research-bot");
  });

  test("rejects duplicate custom profile ids", async () => {
    tempConfigDir = await mkdtemp(
      path.join(os.tmpdir(), "nakama-profile-duplicate-id-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());

    await service.createProfile(ORG_ID, { id: "support", name: "Support" });

    await expect(
      service.createProfile(ORG_ID, { id: "support", name: "Support 2" })
    ).rejects.toThrow(/already exists/i);
  });

  test("rejects invalid custom profile ids", async () => {
    const service = new ProfileService(createInMemoryDatabaseAdapter());

    await expect(
      service.createProfile(ORG_ID, { id: "../escape", name: "Bad Bot" })
    ).rejects.toThrow(/profile id must/i);
  });
});

describe("profile service assignSkill", () => {
  let tempConfigDir = "";
  const originalPath = process.env.PATH ?? "";
  const originalDisableFixPath = process.env.NAKAMA_DISABLE_FIX_PATH;

  afterEach(async () => {
    process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    process.env.PATH = originalPath;
    if (originalDisableFixPath === undefined) {
      delete process.env.NAKAMA_DISABLE_FIX_PATH;
    } else {
      process.env.NAKAMA_DISABLE_FIX_PATH = originalDisableFixPath;
    }

    if (tempConfigDir) {
      await rm(tempConfigDir, { force: true, recursive: true });
      tempConfigDir = "";
    }
  });

  test("assigns coding-agent without requiring a ready coding harness", async () => {
    tempConfigDir = await mkdtemp(
      path.join(os.tmpdir(), "nakama-profile-assign-skill-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    process.env.PATH = tempConfigDir;
    process.env.NAKAMA_DISABLE_FIX_PATH = "1";

    const db = createInMemoryDatabaseAdapter();
    await ensureBuiltinToolDefinitions(db);
    const now = new Date().toISOString();
    await db.upsertSkill({
      createdAt: now,
      createdBy: "bundled",
      description: "Delegate coding work",
      disableModelInvocation: false,
      enabled: true,
      hasTool: false,
      id: "skill_coding_delegation",
      name: "coding-agent",
      sourcePath: "/tmp/coding-agent",
      updatedAt: now,
    });

    const service = new ProfileService(db);
    const created = await service.createProfile(ORG_ID, { name: "Worker Bot" });

    const updated = await service.assignSkill(ORG_ID, created.profile.id, {
      skillId: "skill_coding_delegation",
    });

    expect(
      updated.profile.skills.some(
        (skill) => skill.id === "skill_coding_delegation"
      )
    ).toBe(true);
  });
});

describe("profile service knowledge base", () => {
  let tempConfigDir = "";

  afterEach(async () => {
    process.env.NAKAMA_CONFIG_DIR = originalConfigDir;

    if (tempConfigDir) {
      await rm(tempConfigDir, { force: true, recursive: true });
      tempConfigDir = "";
    }
  });

  test("uploads, lists, and deletes knowledge base documents", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-kb-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile(ORG_ID, { name: "KB Bot" });
    const profileId = created.profile.id;

    const uploaded = await service.uploadKnowledgeBaseDocument(
      ORG_ID,
      profileId,
      {
        data: Buffer.from("project fact", "utf8").toString("base64"),
        filename: "notes.txt",
        mediaType: "text/plain",
      }
    );

    expect(uploaded.document.status).toBe("ready");
    expect(uploaded.profileId).toBe(profileId);

    const listed = await service.listKnowledgeBase(ORG_ID, profileId);
    expect(listed.documents).toHaveLength(1);
    expect(listed.documents[0]?.filename).toBe("notes.txt");

    const deleted = await service.deleteKnowledgeBaseDocument(
      ORG_ID,
      profileId,
      uploaded.document.id
    );
    expect(deleted.deleted).toBe(true);

    const afterDelete = await service.listKnowledgeBase(ORG_ID, profileId);
    expect(afterDelete.documents).toHaveLength(0);
  });

  test("readKnowledgeBaseDocument returns preview text and download bytes", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-kb-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile(ORG_ID, { name: "KB Bot" });
    const profileId = created.profile.id;

    const uploaded = await service.uploadKnowledgeBaseDocument(
      ORG_ID,
      profileId,
      {
        data: Buffer.from("project fact", "utf8").toString("base64"),
        filename: "notes.txt",
        mediaType: "text/plain",
      }
    );

    const preview = await service.readKnowledgeBaseDocument(
      ORG_ID,
      profileId,
      uploaded.document.id,
      { render: "text" }
    );
    expect(preview.contentType).toBe("text/plain");
    expect(preview.bytes.toString("utf8")).toBe("project fact");

    const download = await service.readKnowledgeBaseDocument(
      ORG_ID,
      profileId,
      uploaded.document.id
    );
    expect(download.bytes.toString("utf8")).toBe("project fact");
  });

  test("readKnowledgeBaseDocument throws for unknown document", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-kb-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile(ORG_ID, { name: "KB Bot" });
    const profileId = created.profile.id;

    await expect(
      service.readKnowledgeBaseDocument(ORG_ID, profileId, "kb_nope", {
        render: "text",
      })
    ).rejects.toThrow(/not found/);
  });
});

describe("profile service cloneProfile", () => {
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
      path.join(os.tmpdir(), "nakama-profile-clone-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    const db = createInMemoryDatabaseAdapter();
    await ensureBuiltinToolDefinitions(db);
    const service = new ProfileService(db);
    const source = await service.createProfile(ORG_ID, {
      model: "anthropic:claude-sonnet-4-6",
      name: "Research Bot",
      systemPrompt: "You research things.",
    });
    return { db, service, sourceId: source.profile.id };
  }

  const soulDirOf = (profileId: string) =>
    path.join(tempConfigDir, "orgs", ORG_ID, "profiles", profileId);

  test("copies prompt, model and assignments onto a new independent id", async () => {
    const { db, service, sourceId } = await setup();
    const before = await service.getProfile(ORG_ID, sourceId);

    const cloned = await service.cloneProfile(ORG_ID, sourceId, {});
    const clone = cloned.profile;

    expect(clone.id).not.toBe(sourceId);
    expect(clone.name).toBe("Research Bot (copy)");
    expect(clone.isDefault).toBe(false);
    expect(clone.isSuper).toBe(false);
    expect(clone.systemPrompt).toBe("You research things.");
    expect(clone.model).toBe("anthropic:claude-sonnet-4-6");
    expect(clone.tools.map((tool) => tool.id).sort()).toEqual(
      before.profile.tools.map((tool) => tool.id).sort()
    );
    expect(await db.listSkillsForProfile(clone.id)).toHaveLength(
      (await db.listSkillsForProfile(sourceId)).length
    );
  });

  test("copies the soul files but leaves MEMORY.md at the template", async () => {
    const { service, sourceId } = await setup();
    const sourceDir = soulDirOf(sourceId);
    await writeFile(path.join(sourceDir, "SOUL.md"), "# Source soul\n", "utf8");
    await writeFile(
      path.join(sourceDir, "MEMORY.md"),
      "- remembered something private\n",
      "utf8"
    );

    const { profile } = await service.cloneProfile(ORG_ID, sourceId, {});
    const cloneDir = soulDirOf(profile.id);

    expect(await readFile(path.join(cloneDir, "SOUL.md"), "utf8")).toContain(
      "# Source soul"
    );
    expect(
      await readFile(path.join(cloneDir, "MEMORY.md"), "utf8")
    ).not.toContain("remembered something private");
  });

  test("does not share the source soul directory", async () => {
    const { service, sourceId } = await setup();
    const { profile } = await service.cloneProfile(ORG_ID, sourceId, {});

    await writeFile(
      path.join(soulDirOf(profile.id), "SOUL.md"),
      "# Edited on the clone\n",
      "utf8"
    );

    expect(
      await readFile(path.join(soulDirOf(sourceId), "SOUL.md"), "utf8")
    ).not.toContain("Edited on the clone");
  });

  test("copies knowledge base documents", async () => {
    const { service, sourceId } = await setup();
    const kbDir = path.join(soulDirOf(sourceId), "knowledge-base");
    await mkdir(kbDir, { recursive: true });
    await writeFile(path.join(kbDir, "doc_1--notes.txt"), "kb body", "utf8");

    const { profile } = await service.cloneProfile(ORG_ID, sourceId, {});

    expect(
      await readFile(
        path.join(soulDirOf(profile.id), "knowledge-base", "doc_1--notes.txt"),
        "utf8"
      )
    ).toBe("kb body");
  });

  test("gives each clone a unique id", async () => {
    const { service, sourceId } = await setup();
    const first = await service.cloneProfile(ORG_ID, sourceId, {});
    const second = await service.cloneProfile(ORG_ID, sourceId, {});

    expect(second.profile.id).not.toBe(first.profile.id);
  });

  test("refuses to clone Super Bot and writes nothing", async () => {
    const { db, service } = await setup();
    const superBot = await service.createProfile(ORG_ID, {
      isSuper: true,
      name: "Super Bot",
    });
    const countBefore = (await db.listProfilesForOrg(ORG_ID)).length;

    await expect(
      service.cloneProfile(ORG_ID, superBot.profile.id, {})
    ).rejects.toThrow(/cannot be cloned/i);

    expect(await db.listProfilesForOrg(ORG_ID)).toHaveLength(countBefore);
  });

  test("carries MCP server assignments across", async () => {
    const { db, service, sourceId } = await setup();
    await db.upsertMcpServer({
      cachedTools: [],
      config: { command: "echo" },
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
    await db.assignMcpServerToProfile(sourceId, "mcp_1");

    const { profile } = await service.cloneProfile(ORG_ID, sourceId, {});

    expect(profile.mcpServers.map((server) => server.id)).toEqual(["mcp_1"]);
  });

  test("copies the avatar", async () => {
    const { service, sourceId } = await setup();
    await service.uploadProfileAvatar(ORG_ID, sourceId, {
      data: tinyPngBase64,
      mediaType: "image/png",
    });

    const { profile } = await service.cloneProfile(ORG_ID, sourceId, {});

    expect(profile.hasAvatar).toBe(true);
    await expect(
      service.getProfileAvatar(ORG_ID, profile.id)
    ).resolves.toBeTruthy();
  });

  test("clones the org default without the clone becoming default", async () => {
    const { db, service, sourceId } = await setup();
    const source = await db.getProfile(sourceId);
    await db.upsertProfile({ ...source!, isDefault: true });

    const { profile } = await service.cloneProfile(ORG_ID, sourceId, {});

    expect(profile.isDefault).toBe(false);
    expect((await db.getProfile(sourceId))?.isDefault).toBe(true);
  });

  test("404s on a missing source", async () => {
    const { service } = await setup();

    await expect(
      service.cloneProfile(ORG_ID, "does-not-exist", {})
    ).rejects.toThrow(/not found/i);
  });
});
