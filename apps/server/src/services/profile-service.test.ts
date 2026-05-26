import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
