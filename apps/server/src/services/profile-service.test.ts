import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { ProfileService } from "./profile-service";

const originalToolsDir = process.env.TINYCLAW_TOOLS_DIR;
const originalConfigDir = process.env.TINYCLAW_CONFIG_DIR;

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("profile service createTool", () => {
  let tempToolsDir = "";

  afterEach(async () => {
    process.env.TINYCLAW_TOOLS_DIR = originalToolsDir;

    if (tempToolsDir) {
      await rm(tempToolsDir, { recursive: true, force: true });
      tempToolsDir = "";
    }
  });

  test("defaults to an executable javascript tool", async () => {
    tempToolsDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-profile-tool-"));
    process.env.TINYCLAW_TOOLS_DIR = tempToolsDir;
    await mkdir(tempToolsDir, { recursive: true });

    await writeFile(
      path.join(tempToolsDir, "echo.js"),
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
    process.env.TINYCLAW_CONFIG_DIR = originalConfigDir;

    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  test("uploads, serves, and deletes profile avatars", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-profile-avatar-"));
    process.env.TINYCLAW_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile({ name: "Avatar Bot" });
    const profileId = created.profile.id;

    expect(created.profile.hasAvatar).toBe(false);

    const updated = await service.uploadProfileAvatar(profileId, {
      mediaType: "image/png",
      data: tinyPngBase64,
    });

    expect(updated.profile.hasAvatar).toBe(true);

    const avatar = await service.getProfileAvatar(profileId);
    expect(avatar.mediaType).toBe("image/png");
    expect(avatar.bytes.length).toBeGreaterThan(0);

    await service.deleteProfileAvatar(profileId);

    const afterDelete = await service.getProfile(profileId);
    expect(afterDelete.profile.hasAvatar).toBe(false);
  });
});

describe("profile service createProfile", () => {
  let tempConfigDir = "";

  afterEach(async () => {
    process.env.TINYCLAW_CONFIG_DIR = originalConfigDir;

    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  test("scaffolds soul templates for new profiles", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-profile-soul-"));
    process.env.TINYCLAW_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile({ name: "Soul Bot" });
    const soulDir = path.join(tempConfigDir, "profiles", created.profile.id);
    const soulContent = await readFile(path.join(soulDir, "SOUL.md"), "utf8");

    expect(soulContent).toContain("# Your Name");
    await expect(readFile(path.join(soulDir, "STYLE.md"), "utf8")).resolves.toContain(
      "# Voice & Style",
    );
  });
});

describe("profile service knowledge base", () => {
  let tempConfigDir = "";

  afterEach(async () => {
    process.env.TINYCLAW_CONFIG_DIR = originalConfigDir;

    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  test("uploads, lists, and deletes knowledge base documents", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-profile-kb-"));
    process.env.TINYCLAW_CONFIG_DIR = tempConfigDir;

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const created = await service.createProfile({ name: "KB Bot" });
    const profileId = created.profile.id;

    const uploaded = await service.uploadKnowledgeBaseDocument(profileId, {
      filename: "notes.txt",
      mediaType: "text/plain",
      data: Buffer.from("project fact", "utf8").toString("base64"),
    });

    expect(uploaded.document.status).toBe("ready");
    expect(uploaded.profileId).toBe(profileId);

    const listed = await service.listKnowledgeBase(profileId);
    expect(listed.documents).toHaveLength(1);
    expect(listed.documents[0]?.filename).toBe("notes.txt");

    const deleted = await service.deleteKnowledgeBaseDocument(profileId, uploaded.document.id);
    expect(deleted.deleted).toBe(true);

    const afterDelete = await service.listKnowledgeBase(profileId);
    expect(afterDelete.documents).toHaveLength(0);
  });
});
