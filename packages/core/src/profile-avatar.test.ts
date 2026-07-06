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

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
const ORG_ID = "org_test";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("profile avatar", () => {
  let tempConfigDir = "";

  afterEach(async () => {
    process.env.NAKAMA_CONFIG_DIR = originalConfigDir;

    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  test("saves, reads, and deletes avatar files", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-avatar-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const profileId = "profile_test";

    expect(await hasProfileAvatar(ORG_ID, profileId)).toBe(false);

    await saveProfileAvatar(ORG_ID, profileId, {
      mediaType: "image/png",
      data: tinyPngBase64,
    });

    expect(await hasProfileAvatar(ORG_ID, profileId)).toBe(true);
    expect(getProfileAvatarPath(ORG_ID, profileId, "image/png")).toEndWith("avatar.png");

    const avatar = await readProfileAvatar(ORG_ID, profileId);

    expect(avatar?.mediaType).toBe("image/png");
    expect(avatar?.bytes.length).toBeGreaterThan(0);

    expect(await deleteProfileAvatar(ORG_ID, profileId)).toBe(true);
    expect(await hasProfileAvatar(ORG_ID, profileId)).toBe(false);
    expect(await readProfileAvatar(ORG_ID, profileId)).toBeNull();
  });

  test("replaces an existing avatar on upload", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-avatar-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const profileId = "profile_test";

    await saveProfileAvatar(ORG_ID, profileId, {
      mediaType: "image/png",
      data: tinyPngBase64,
    });

    await saveProfileAvatar(ORG_ID, profileId, {
      mediaType: "image/jpeg",
      data: tinyPngBase64,
    });

    expect(await hasProfileAvatar(ORG_ID, profileId)).toBe(true);
    expect(getProfileAvatarPath(ORG_ID, profileId, "image/jpeg")).toEndWith("avatar.jpg");

    const avatar = await readProfileAvatar(ORG_ID, profileId);
    expect(avatar?.mediaType).toBe("image/jpeg");
  });
});
