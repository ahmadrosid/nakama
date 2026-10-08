import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getProfileArtifactsDir,
  WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES,
} from "@nakama/core";
import {
  sendDiscordArtifactTool,
  sendWhatsAppArtifactTool,
} from "./send-discord-artifact-tool";

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

test("WhatsApp preparation validates scope and pins bounded file contents", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "nakama-whatsapp-tool-"));
  process.env.NAKAMA_CONFIG_DIR = home;

  try {
    const context = {
      channel: "whatsapp" as const,
      orgId: "org",
      profileId: "profile",
    };

    const dir = getProfileArtifactsDir("org", "profile");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "report.csv"), "a,b\n1,2");

    const result = await sendWhatsAppArtifactTool.run(
      { path: "artifacts/report.csv" },
      context
    );

    expect(result).toMatchObject({
      ok: true,
      path: "report.csv",
      sha256: createHash("sha256").update("a,b\n1,2").digest("hex"),
      sizeBytes: 7,
      status: "prepared",
    });

    for (const ctx of [
      {},
      { ...context, channel: "web" as const },
      { ...context, orgId: "other" },
      { ...context, workspaceRoot: home },
    ]) {
      expect(
        await sendWhatsAppArtifactTool.run({ path: "report.csv" }, ctx)
      ).toMatchObject({ ok: false });
    }

    for (const name of [
      "../report.csv",
      "/report.csv",
      "missing.csv",
      ".",
      "C:\\report.csv",
    ]) {
      expect(
        await sendWhatsAppArtifactTool.run({ path: name }, context)
      ).toMatchObject({ ok: false });
    }

    await writeFile(path.join(home, "secret.csv"), "secret");
    await symlink(path.join(home, "secret.csv"), path.join(dir, "escape.csv"));
    expect(
      await sendWhatsAppArtifactTool.run({ path: "escape.csv" }, context)
    ).toMatchObject({ ok: false });
    await writeFile(
      path.join(dir, "huge.bin"),
      Buffer.alloc(WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES + 1)
    );
    expect(
      await sendWhatsAppArtifactTool.run({ path: "huge.bin" }, context)
    ).toMatchObject({ ok: false });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});
