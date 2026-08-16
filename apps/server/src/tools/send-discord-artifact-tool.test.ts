import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getProfileArtifactsDir } from "@nakama/core";
import { sendDiscordArtifactTool } from "./send-discord-artifact-tool";

const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.NAKAMA_CONFIG_DIR;
  } else {
    process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
  }
});

describe("sendDiscordArtifactTool", () => {
  test("rejects non-discord channels", async () => {
    const result = await sendDiscordArtifactTool.run(
      { path: "report.pdf" },
      { channel: "web", orgId: "org", profileId: "profile" }
    );
    expect(result).toEqual({
      error: "send_discord_artifact is only available in Discord chats.",
      ok: false,
    });
  });

  test("accepts an existing attachable artifact on discord", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "nakama-discord-tool-"));
    process.env.NAKAMA_CONFIG_DIR = home;
    const orgId = "org_test";
    const profileId = "profile_test";
    const artifactsDir = getProfileArtifactsDir(orgId, profileId);
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(
      path.join(artifactsDir, "nakama-pitch-deck.pdf"),
      "%PDF-1.4"
    );

    const result = await sendDiscordArtifactTool.run(
      { path: "artifacts/nakama-pitch-deck.pdf" },
      { channel: "discord", orgId, profileId }
    );

    expect(result).toEqual({
      filename: "nakama-pitch-deck.pdf",
      mimeType: "application/pdf",
      ok: true,
      path: "nakama-pitch-deck.pdf",
      sizeBytes: 8,
    });
  });
});
