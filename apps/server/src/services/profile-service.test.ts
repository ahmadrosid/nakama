import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
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
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  test("defaults to an executable javascript tool", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-tool-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    const toolsDir = path.join(tempConfigDir, "tools");
    await mkdir(toolsDir, { recursive: true });

    await writeFile(
      path.join(toolsDir, "echo.js"),
      `export async function run(input) {
  return input;
}
`,
      "utf8",
    );

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const tool = await service.createTool({
      name: "echo",
      description: "Echo input",
      handlerConfig: { modulePath: "echo.js" },
    });

    expect(tool.handlerType).toBe("javascript");
  });

  test('rejects non-javascript handler types', async () => {
    const service = new ProfileService(createInMemoryDatabaseAdapter());

    await expect(
      service.createTool({
        name: "bad-tool",
        description: "Bad tool",
        handlerType: "custom",
        handlerConfig: { modulePath: "bad-tool.js" },
      }),
    ).rejects.toThrow(/only javascript tools can be created/i);
  });
});

describe("profile service avatar", () => {
  let tempConfigDir = "";

  afterEach(async () => {
    process.env.NAKAMA_CONFIG_DIR = originalConfigDir;

    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  test("uploads, serves, and deletes profile avatars", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-avatar-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile(ORG_ID, { name: "Avatar Bot" });
    const profileId = created.profile.id;

    expect(created.profile.hasAvatar).toBe(false);

    const updated = await service.uploadProfileAvatar(ORG_ID, profileId, {
      mediaType: "image/png",
      data: tinyPngBase64,
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
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  test("scaffolds soul templates for new profiles", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-soul-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile(ORG_ID, { name: "Soul Bot" });
    const soulDir = path.join(tempConfigDir, "orgs", ORG_ID, "profiles", created.profile.id);
    const soulContent = await readFile(path.join(soulDir, "SOUL.md"), "utf8");

    expect(soulContent.trim().length).toBeGreaterThan(0);
    await expect(readFile(path.join(soulDir, "STYLE.md"), "utf8")).resolves.toMatch(/\S/);
  });

  test("assigns basic tools when the built-in tools exist", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-default-tools-"));
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
    expect(tools.map((tool) => tool.name)).not.toContain("update_profile_memory");
    expect(tools.map((tool) => tool.name)).not.toContain("web_search");
  });

  test("assigns default bundled skills when they exist", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-default-skills-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const db = createInMemoryDatabaseAdapter();
    const now = new Date().toISOString();
    await db.upsertSkill({
      id: "skill_manage_skills",
      name: "manage-skills",
      description: "Create, update, inspect, or manage reusable profile skills.",
      sourcePath: path.join(tempConfigDir, "agent", "skills", "manage-skills"),
      hasTool: false,
      disableModelInvocation: false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });

    const service = new ProfileService(db);
    const created = await service.createProfile(ORG_ID, { name: "Skill Bot" });
    const skills = await db.listSkillsForProfile(created.profile.id);

    expect(skills.map((skill) => skill.name)).toContain("manage-skills");
  });

  test("skips missing basic built-in tools without failing", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-missing-tools-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const db = createInMemoryDatabaseAdapter();

    const service = new ProfileService(db);
    const created = await service.createProfile(ORG_ID, { name: "No Tools Bot" });
    const tools = await db.listToolsForProfile(created.profile.id);

    expect(tools).toEqual([]);
  });

  test("writes generated soul files and keeps memory empty", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-generated-soul-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile(ORG_ID, {
      name: "Support Bot",
      soulFiles: {
        "SOUL.md": "# Support Bot\n\nHelps customers.",
        "STYLE.md": "# Style\n\nClear and kind.",
        "INSTRUCTIONS.md": "# Instructions\n\nEscalate billing risks.",
      },
    });
    const soulDir = path.join(tempConfigDir, "orgs", ORG_ID, "profiles", created.profile.id);

    await expect(readFile(path.join(soulDir, "SOUL.md"), "utf8")).resolves.toContain(
      "# Support Bot",
    );
    await expect(readFile(path.join(soulDir, "STYLE.md"), "utf8")).resolves.toContain(
      "Clear and kind",
    );
    await expect(readFile(path.join(soulDir, "INSTRUCTIONS.md"), "utf8")).resolves.toContain(
      "Escalate billing risks",
    );
    await expect(readFile(path.join(soulDir, "MEMORY.md"), "utf8")).resolves.toBe("");
  });

  test("rejects unsupported generated soul file keys", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-bad-soul-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());

    await expect(
      service.createProfile(ORG_ID, {
        name: "Bad Soul Bot",
        soulFiles: {
          "../SOUL.md": "# Bad",
        } as never,
      }),
    ).rejects.toThrow(/unsupported soul file/i);
  });

  test("stores profile model selection", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-model-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());

    const created = await service.createProfile(ORG_ID, {
      name: "Model Bot",
      model: "openai:gpt-5",
    });

    expect(created.profile.model).toBe("openai:gpt-5");

    const updated = await service.updateProfile(ORG_ID, created.profile.id, {
      model: "anthropic:claude-sonnet-4",
    });

    expect(updated.profile.model).toBe("anthropic:claude-sonnet-4");
  });

  test("uses a slug from the profile name when id is omitted", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-slug-id-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile(ORG_ID, { name: "Research Assistant" });

    expect(created.profile.id).toBe("research-assistant");
  });

  test("uses a custom profile id when provided", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-custom-id-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile(ORG_ID, {
      id: "research-bot",
      name: "Research Bot",
    });

    expect(created.profile.id).toBe("research-bot");
  });

  test("rejects duplicate custom profile ids", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-duplicate-id-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());

    await service.createProfile(ORG_ID, { id: "support", name: "Support" });

    await expect(
      service.createProfile(ORG_ID, { id: "support", name: "Support 2" }),
    ).rejects.toThrow(/already exists/i);
  });

  test("rejects invalid custom profile ids", async () => {
    const service = new ProfileService(createInMemoryDatabaseAdapter());

    await expect(
      service.createProfile(ORG_ID, { id: "../escape", name: "Bad Bot" }),
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
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  test("blocks coding-delegation until a coding harness is ready", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-assign-skill-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    process.env.PATH = tempConfigDir;
    process.env.NAKAMA_DISABLE_FIX_PATH = "1";

    const db = createInMemoryDatabaseAdapter();
    await ensureBuiltinToolDefinitions(db);
    const now = new Date().toISOString();
    await db.upsertSkill({
      id: "skill_coding_delegation",
      name: "coding-delegation",
      description: "Delegate coding work",
      sourcePath: "/tmp/coding-delegation",
      hasTool: false,
      disableModelInvocation: false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });

    const service = new ProfileService(db);
    const created = await service.createProfile(ORG_ID, { name: "Worker Bot" });

    await expect(
      service.assignSkill(ORG_ID, created.profile.id, {
        skillId: "skill_coding_delegation",
      }),
    ).rejects.toThrow(/configure a ready coding agent harness/i);
  });
});

describe("profile service knowledge base", () => {
  let tempConfigDir = "";

  afterEach(async () => {
    process.env.NAKAMA_CONFIG_DIR = originalConfigDir;

    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  test("uploads, lists, and deletes knowledge base documents", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-profile-kb-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile(ORG_ID, { name: "KB Bot" });
    const profileId = created.profile.id;

    const uploaded = await service.uploadKnowledgeBaseDocument(ORG_ID, profileId, {
      filename: "notes.txt",
      mediaType: "text/plain",
      data: Buffer.from("project fact", "utf8").toString("base64"),
    });

    expect(uploaded.document.status).toBe("ready");
    expect(uploaded.profileId).toBe(profileId);

    const listed = await service.listKnowledgeBase(ORG_ID, profileId);
    expect(listed.documents).toHaveLength(1);
    expect(listed.documents[0]?.filename).toBe("notes.txt");

    const deleted = await service.deleteKnowledgeBaseDocument(
      ORG_ID,
      profileId,
      uploaded.document.id,
    );
    expect(deleted.deleted).toBe(true);

    const afterDelete = await service.listKnowledgeBase(ORG_ID, profileId);
    expect(afterDelete.documents).toHaveLength(0);
  });
});
