import { describe, expect, test } from "bun:test";
import {
  DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES,
  isDiscordAttachableArtifact,
} from "@nakama/core/discord-attachment";
import type { TextBasedChannel } from "discord.js";
import { sendDiscordArtifactAttachment } from "./send-artifact-attachment";

describe("sendDiscordArtifactAttachment limits", () => {
  test("accepts common Discord attachment types", () => {
    expect(
      isDiscordAttachableArtifact({
        filename: "deck.pdf",
        mimeType: "application/pdf",
      })
    ).toBe(true);
    expect(
      isDiscordAttachableArtifact({
        filename: "export.csv",
        mimeType: "text/csv",
      })
    ).toBe(true);
    expect(
      isDiscordAttachableArtifact({
        filename: "shot.png",
        mimeType: "image/png",
      })
    ).toBe(true);
    expect(
      isDiscordAttachableArtifact({
        filename: "bundle.zip",
        mimeType: "application/zip",
      })
    ).toBe(true);
  });

  test("rejects unsupported attachment types with a clear reason", () => {
    expect(
      isDiscordAttachableArtifact({
        filename: "payload.exe",
        mimeType: "application/octet-stream",
      })
    ).toBe(false);
  });

  test("rejects oversized attachments", async () => {
    // SAFETY: Oversize validation returns before the mock channel can be used.
    const channel = {
      send: async () => {
        throw new Error("should not send");
      },
    } as TextBasedChannel;

    const result = await sendDiscordArtifactAttachment(channel, {
      bytes: new Uint8Array(DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES + 1),
      filename: "big.pdf",
      mimeType: "application/pdf",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
