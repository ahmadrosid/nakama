import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  deleteProfileAvatar,
  getProfileAvatarPath,
  hasProfileAvatar,
  readProfileAvatar,
  saveProfileAvatar,
} from "./profile-avatar";

const originalConfigDir = process.env.TINYCLAW_CONFIG_DIR;

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("profile avatar", () => {
  let tempConfigDir = "";

  afterEach(async () => {
    process.env.TINYCLAW_CONFIG_DIR = originalConfigDir;

    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  test("saves, reads, and deletes avatar files", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-avatar-"));
    process.env.TINYCLAW_CONFIG_DIR = tempConfigDir;

    const profileId = "profile_test";

    expect(await hasProfileAvatar(profileId)).toBe(false);

    await saveProfileAvatar(profileId, {
      mediaType: "image/png",
      data: tinyPngBase64,
    });

    expect(await hasProfileAvatar(profileId)).toBe(true);
    expect(getProfileAvatarPath(profileId, "image/png")).toEndWith("avatar.png");

    const avatar = await readProfileAvatar(profileId);

    expect(avatar?.mediaType).toBe("image/png");
    expect(avatar?.bytes.length).toBeGreaterThan(0);

    expect(await deleteProfileAvatar(profileId)).toBe(true);
    expect(await hasProfileAvatar(profileId)).toBe(false);
    expect(await readProfileAvatar(profileId)).toBeNull();
  });

  test("replaces an existing avatar on upload", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-avatar-"));
    process.env.TINYCLAW_CONFIG_DIR = tempConfigDir;

    const profileId = "profile_test";

    await saveProfileAvatar(profileId, {
      mediaType: "image/png",
      data: tinyPngBase64,
    });

    await saveProfileAvatar(profileId, {
      mediaType: "image/jpeg",
      data: tinyPngBase64,
    });

    expect(await hasProfileAvatar(profileId)).toBe(true);
    expect(getProfileAvatarPath(profileId, "image/jpeg")).toEndWith("avatar.jpg");

    const avatar = await readProfileAvatar(profileId);
    expect(avatar?.mediaType).toBe("image/jpeg");
  });
});
